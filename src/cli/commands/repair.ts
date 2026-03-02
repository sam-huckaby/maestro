import { Command } from 'commander';
import { basename } from 'node:path';
import { spawn } from 'node:child_process';
import { Config } from '../../config/Config.js';
import { logger } from '../ui/index.js';
import { formatError } from '../../utils/errors.js';
import { createLLMProvider } from '../../llm/LLMProvider.js';
import { createDevOps, type BuildResult } from '../../agents/devops/DevOps.js';
import { createImplementer } from '../../agents/implementer/Implementer.js';
import { FileContext } from '../../context/FileContext.js';
import { profileProject, type ProjectProfile } from '../../context/profileProject.js';
import { createTask } from '../../tasks/Task.js';
import { formatArtifact } from '../../tasks/HandoffPayload.js';
import type { LLMProvider } from '../../llm/types.js';
import type { AgentResponse } from '../../agents/base/types.js';
import type { TaskContext, ProjectContext } from '../../tasks/types.js';
import { initializeMemory, closeMemory } from '../../memory/MemoryManager.js';
import { resetAgentRegistry } from '../../agents/base/AgentRegistry.js';
import { isTokfAvailable, wrapWithTokf } from '../../utils/tokf.js';

const DEFAULT_MAX_TRIES = 5;
const MAX_DEVOPS_CONTEXT_CHARS = 3000;
const MAX_IMPLEMENTER_CONTEXT_CHARS = 12000;
const INSTALL_TIMEOUT_MS = 120_000;

type RepairPhase = 'install' | 'build' | 'test';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RepairOptions {
  tries?: string;
  verbose?: boolean;
  json?: boolean;
  fixInstall?: boolean;
}

interface RepairStepResult {
  success: boolean;
  output: string;
  artifactCount: number;
  nextAction?: string;
}

interface RepairIterationResult {
  phase: RepairPhase;
  try: number;
  devops: RepairStepResult;
  implementer?: RepairStepResult;
}

interface PhaseLoopResult {
  succeeded: boolean;
  iterations: RepairIterationResult[];
  triesUsed: number;
}

interface RepairPayload {
  success: boolean;
  installPassed: boolean;
  buildPassed: boolean;
  testsPassed: boolean;
  maxTries: number;
  attempts: number;
  projectProfile: ProjectProfile;
  iterations: RepairIterationResult[];
}

interface RepairAgents {
  devops: ReturnType<typeof createDevOps>;
  implementer: ReturnType<typeof createImplementer>;
  taskContext: TaskContext;
}

interface RepairSession {
  llmProvider: LLMProvider;
  fileContext: FileContext;
  agents: RepairAgents;
}

// --- Pure helper functions ---

function parseTriesOption(triesOption?: string): number {
  if (!triesOption) return DEFAULT_MAX_TRIES;

  const parsed = Number.parseInt(triesOption, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --tries value "${triesOption}". Expected a positive integer.`);
  }

  return parsed;
}

function createStepResult(response: AgentResponse): RepairStepResult {
  return {
    success: response.success,
    output: response.output,
    artifactCount: response.artifacts.length,
    nextAction: response.nextAction?.type,
  };
}

function truncateForContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated for context]`;
}

function truncateForLog(value: string, maxChars = 500): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function resolveProjectName(workingDirectory: string): string {
  const derivedName = basename(workingDirectory).trim();
  return derivedName.length > 0 ? derivedName : 'current-project';
}

function formatProfileSummary(profile: ProjectProfile): string {
  const lines = [
    `  Build: ${profile.buildCommand}`,
    `  Test: ${profile.testCommand}`,
    `  Install: ${profile.installCommand}`,
    `  Languages: ${profile.languages.join(', ') || 'unknown'}`,
  ];
  if (profile.packageManager) lines.push(`  Package manager: ${profile.packageManager}`);
  if (profile.bundler) lines.push(`  Bundler: ${profile.bundler}`);
  if (profile.framework) lines.push(`  Framework: ${profile.framework}`);
  if (profile.monorepo) lines.push(`  Monorepo: yes`);
  if (profile.notes) lines.push(`  Notes: ${profile.notes}`);
  return lines.join('\n');
}

function formatProfileContext(profile: ProjectProfile): string {
  return [
    `Build command: ${profile.buildCommand}`,
    `Test command: ${profile.testCommand}`,
    `Install command: ${profile.installCommand}`,
    `Languages: ${profile.languages.join(', ')}`,
    profile.packageManager ? `Package manager: ${profile.packageManager}` : null,
    profile.bundler ? `Bundler: ${profile.bundler}` : null,
    profile.framework ? `Framework: ${profile.framework}` : null,
    profile.monorepo ? `Monorepo: yes` : null,
    profile.notes ? `Notes: ${profile.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function phaseCommand(profile: ProjectProfile, phase: RepairPhase): string {
  if (phase === 'install') return profile.installCommand;
  return phase === 'build' ? profile.buildCommand : profile.testCommand;
}

function buildDevOpsContext(
  attempt: number,
  maxTries: number,
  latestImplementerOutput: string,
  profile: ProjectProfile,
  phase: RepairPhase
): string {
  let context = [
    `Repair loop ${attempt} of ${maxTries}.`,
    `Run the ${phase} command and report any blocking errors.`,
    '',
    'Project profile:',
    formatProfileContext(profile),
  ].join('\n');

  if (latestImplementerOutput.trim()) {
    context += '\n\nLatest implementer summary:\n';
    context += truncateForContext(latestImplementerOutput, MAX_DEVOPS_CONTEXT_CHARS);
  }

  return context;
}

function buildImplementerContext(
  attempt: number,
  maxTries: number,
  profile: ProjectProfile,
  devopsOutput: string,
  phase: RepairPhase
): string {
  return [
    `DevOps ${phase} failed during repair loop ${attempt} of ${maxTries}.`,
    `Use the error details below to fix the project so the next ${phase} can pass.`,
    '',
    'Project profile:',
    formatProfileContext(profile),
    '',
    'DevOps output:',
    truncateForContext(devopsOutput, MAX_IMPLEMENTER_CONTEXT_CHARS),
  ].join('\n');
}

function buildRepairPayload(
  installPassed: boolean,
  buildPassed: boolean,
  testsPassed: boolean,
  maxTries: number,
  profile: ProjectProfile,
  iterations: RepairIterationResult[]
): RepairPayload {
  return {
    success: installPassed && buildPassed && testsPassed,
    installPassed,
    buildPassed,
    testsPassed,
    maxTries,
    attempts: iterations.length,
    projectProfile: profile,
    iterations,
  };
}

function formatHandoffSummary(devopsResponse: AgentResponse, attempt: number): string {
  const buildResult = devopsResponse.metadata.buildResult as BuildResult | undefined;
  const errorCount = buildResult?.errors?.length ?? 0;
  const command = buildResult?.command ?? 'unknown';
  const exitCode = buildResult?.exitCode ?? '?';

  return [
    `[Loop ${attempt}] DevOps -> Implementer handoff:`,
    `  Command: ${command} (exit ${exitCode})`,
    `  Errors found: ${errorCount}`,
    `  Output: ${truncateForLog(devopsResponse.output)}`,
  ].join('\n');
}

// --- Direct command execution (no LLM) ---

function runCommand(command: string, cwd: string): Promise<CommandResult> {
  const finalCommand = isTokfAvailable() ? wrapWithTokf(command) : command;

  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', finalCommand], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${INSTALL_TIMEOUT_MS}ms: ${command}`));
    }, INSTALL_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

async function runInstallPhase(
  profile: ProjectProfile,
  cwd: string,
  isJson: boolean
): Promise<boolean> {
  if (!isJson) {
    logger.agent('install', `Running: ${profile.installCommand}`);
  }

  const result = await runCommand(profile.installCommand, cwd);

  if (!isJson) {
    const status = result.exitCode === 0 ? 'succeeded' : 'failed';
    logger.agent('install', `Install ${status} (exit ${result.exitCode})`);
  }

  return result.exitCode === 0;
}

// --- Side-effect functions (logging, I/O) ---

function logStartup(maxTries: number, isJson: boolean): void {
  if (isJson) return;

  logger.info(`Starting repair loop (max tries: ${maxTries})`);
  if (isTokfAvailable()) {
    logger.info('tokf detected — build output will be compressed');
  } else {
    logger.debug(
      'tokf not found — install tokf for compressed build output (https://github.com/mpecan/tokf)'
    );
  }
  logger.blank();
}

function logProjectProfile(profile: ProjectProfile, isJson: boolean): void {
  if (isJson) return;
  logger.success('Project profile:');
  console.log(formatProfileSummary(profile));
  logger.blank();
}

function logPhaseCommand(devopsResponse: AgentResponse, phase: RepairPhase, isJson: boolean): void {
  if (isJson) return;

  const buildResult = devopsResponse.metadata.buildResult as BuildResult | undefined;
  const command = buildResult?.command ?? 'unknown';
  const exitCode = buildResult?.exitCode ?? '?';
  const errorCount = buildResult?.errors?.length ?? 0;
  const status = buildResult?.success ? 'passed' : 'failed';

  logger.agent('devops', JSON.stringify(buildResult));
  logger.agent(
    'devops',
    `${phase} command: ${command} (exit ${exitCode}, ${errorCount} errors, ${status})`
  );
}

function logDevOpsHandoff(
  devopsResponse: AgentResponse,
  attempt: number,
  options: RepairOptions
): void {
  if (options.json) return;
  logger.debug(formatHandoffSummary(devopsResponse, attempt));
}

function reportRepairResults(payload: RepairPayload, options: RepairOptions): void {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  logger.blank();
  logger.info(`Repair attempts: ${payload.attempts}/${payload.maxTries}`);

  if (payload.success) {
    logger.success('Repair completed: install, build, and tests passing');
  } else if (!payload.installPassed) {
    logger.error('Repair incomplete: install still failing');
  } else if (!payload.buildPassed) {
    logger.error('Repair incomplete: build still failing');
  } else {
    logger.error('Repair incomplete: build passing but tests still failing');
  }
}

// --- Async task functions ---

async function runDevOpsPhaseCheck(
  devops: ReturnType<typeof createDevOps>,
  taskContext: TaskContext,
  attempt: number,
  maxTries: number,
  latestImplementerOutput: string,
  profile: ProjectProfile,
  phase: RepairPhase
): Promise<AgentResponse> {
  const command = phaseCommand(profile, phase);
  const devopsTask = createTask({
    goal: `Run the ${phase} command: ${command}`,
    description: `Execute "${command}" and report any errors that block success.`,
    metadata: { phaseCommand: command },
    handoff: {
      context: buildDevOpsContext(attempt, maxTries, latestImplementerOutput, profile, phase),
      constraints: [
        `Execute this exact command using run_command: ${command}`,
        'Report exact error messages, file locations, and line numbers.',
        `If ${phase} fails, provide actionable errors for Implementer to fix.`,
      ],
    },
  });

  return devops.execute(devopsTask, taskContext);
}

async function runImplementerFix(
  implementer: ReturnType<typeof createImplementer>,
  taskContext: TaskContext,
  attempt: number,
  maxTries: number,
  profile: ProjectProfile,
  devopsResponse: AgentResponse,
  phase: RepairPhase
): Promise<AgentResponse> {
  const implementerTask = createTask({
    goal: `Fix the project based on DevOps ${phase} errors.`,
    description: `Apply minimal code changes to resolve current ${phase} failures.`,
    handoff: {
      context: buildImplementerContext(attempt, maxTries, profile, devopsResponse.output, phase),
      constraints: [
        `Make targeted fixes for reported ${phase} errors.`,
        `Avoid unrelated refactors unless required for ${phase} stability.`,
      ],
      artifacts: devopsResponse.artifacts.map((artifact) => formatArtifact(artifact)),
    },
  });

  return implementer.execute(implementerTask, taskContext);
}

function createRepairSession(config: ReturnType<typeof Config.get>): RepairSession {
  const workingDirectory = process.cwd();
  const projectName = resolveProjectName(workingDirectory);

  const projectContext: ProjectContext = {
    name: projectName,
    description: 'Repair project build errors',
    workingDirectory,
    constraints: [],
    preferences: {},
  };

  const llmProvider = createLLMProvider(config.llm);
  const fileContext = new FileContext({ workingDirectory });

  return {
    llmProvider,
    fileContext,
    agents: {
      devops: createDevOps({ llmProvider }),
      implementer: createImplementer({ llmProvider }),
      taskContext: {
        parentTask: undefined,
        relatedTasks: [],
        projectContext,
        fileContext,
        executionHistory: [],
      },
    },
  };
}

// --- Main repair loop ---

async function executePhaseLoop(
  agents: RepairAgents,
  triesRemaining: number,
  profile: ProjectProfile,
  options: RepairOptions,
  phase: RepairPhase
): Promise<PhaseLoopResult> {
  const iterations: RepairIterationResult[] = [];
  let latestImplementerOutput = '';
  let succeeded = false;

  for (let attempt = 1; attempt <= triesRemaining; attempt++) {
    if (!options.json) {
      logger.agent('devops', `${phase} loop ${attempt}/${triesRemaining}: running diagnostics`);
    }

    const devopsResponse = await runDevOpsPhaseCheck(
      agents.devops,
      agents.taskContext,
      attempt,
      triesRemaining,
      latestImplementerOutput,
      profile,
      phase
    );

    logPhaseCommand(devopsResponse, phase, !!options.json);

    const iteration: RepairIterationResult = {
      phase,
      try: attempt,
      devops: createStepResult(devopsResponse),
    };

    if (options.verbose && !options.json) {
      logger.debug(`DevOps output (${phase} ${attempt}): ${truncateForLog(devopsResponse.output)}`);
    }

    if (devopsResponse.success) {
      succeeded = true;
      iterations.push(iteration);
      if (!options.json) logger.success(`${phase} succeeded on loop ${attempt}`);
      break;
    }

    if (attempt === triesRemaining) {
      iterations.push(iteration);
      if (!options.json) logger.error(`${phase} still failing after ${triesRemaining} loop(s)`);
      break;
    }

    if (!options.json) {
      logger.handoff('devops', 'implementer', `${phase} failed - apply targeted fixes`);
    }

    logDevOpsHandoff(devopsResponse, attempt, options);

    const implementerResponse = await runImplementerFix(
      agents.implementer,
      agents.taskContext,
      attempt,
      triesRemaining,
      profile,
      devopsResponse,
      phase
    );

    latestImplementerOutput = implementerResponse.output;
    iteration.implementer = createStepResult(implementerResponse);
    iterations.push(iteration);

    if (options.verbose && !options.json) {
      logger.debug(
        `Implementer output (${phase} ${attempt}): ${truncateForLog(implementerResponse.output)}`
      );
    }
  }

  return { succeeded, iterations, triesUsed: iterations.length };
}

// --- Command definition ---

export const repairCommand = new Command('repair')
  .description('Run install, build, and test phases with DevOps/Implementer repair loops')
  .option('-t, --tries <count>', `Maximum repair loops to run (default: ${DEFAULT_MAX_TRIES})`)
  .option('-v, --verbose', 'Enable verbose output')
  .option('-j, --json', 'Output results as JSON')
  .option('--fix-install', 'Attempt to fix install failures using the repair loop')
  .action(async (options: RepairOptions) => {
    try {
      await Config.load();
      const config = Config.get();

      if (options.verbose) logger.setLevel('debug');

      const maxTries = parseTriesOption(options.tries);
      logStartup(maxTries, !!options.json);

      initializeMemory(config.memory);
      const session = createRepairSession(config);

      const cachedProfile = config.project;
      let profile: ProjectProfile;

      if (cachedProfile) {
        profile = cachedProfile;
        if (!options.json) {
          logger.info('Using cached project profile from maestro.config.json');
        }
      } else {
        if (!options.json) {
          logger.agent('profiler', 'Analyzing project to identify build configuration...');
        }
        profile = await profileProject(session.llmProvider, session.fileContext, !!options.json);
      }

      logProjectProfile(profile, !!options.json);

      // Phase 1: Install dependencies
      const cwd = session.agents.taskContext.projectContext.workingDirectory;
      let triesRemaining = maxTries;
      let installIterations: RepairIterationResult[] = [];

      const installOk = await runInstallPhase(profile, cwd, !!options.json);

      if (!installOk && options.fixInstall) {
        const installResult = await executePhaseLoop(
          session.agents,
          triesRemaining,
          profile,
          options,
          'install'
        );
        triesRemaining -= installResult.triesUsed;
        installIterations = installResult.iterations;

        if (!installResult.succeeded) {
          const payload = buildRepairPayload(
            false,
            false,
            false,
            maxTries,
            profile,
            installIterations
          );
          reportRepairResults(payload, options);
          process.exit(1);
        }
      } else if (!installOk) {
        throw new Error('Install failed. Use --fix-install to attempt automated repair.');
      }

      // Phase 2: Build loop
      const buildResult = await executePhaseLoop(
        session.agents,
        triesRemaining,
        profile,
        options,
        'build'
      );
      triesRemaining -= buildResult.triesUsed;

      if (!buildResult.succeeded) {
        const allIterations = [...installIterations, ...buildResult.iterations];
        const payload = buildRepairPayload(true, false, false, maxTries, profile, allIterations);
        reportRepairResults(payload, options);
        process.exit(1);
      }

      // Phase 3: Test loop (uses remaining budget)
      const testResult = await executePhaseLoop(
        session.agents,
        Math.max(triesRemaining, 1),
        profile,
        options,
        'test'
      );

      const allIterations = [
        ...installIterations,
        ...buildResult.iterations,
        ...testResult.iterations,
      ];
      const payload = buildRepairPayload(
        true,
        true,
        testResult.succeeded,
        maxTries,
        profile,
        allIterations
      );
      reportRepairResults(payload, options);

      if (!testResult.succeeded) process.exit(1);
    } catch (error) {
      if (!options.json) {
        logger.error(formatError(error));
      } else {
        console.log(JSON.stringify({ success: false, error: formatError(error) }, null, 2));
      }
      process.exit(1);
    } finally {
      closeMemory();
      resetAgentRegistry();
    }
  });
