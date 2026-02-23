import { Command } from 'commander';
import { basename } from 'node:path';
import { Config } from '../../config/Config.js';
import { logger } from '../ui/index.js';
import { formatError } from '../../utils/errors.js';
import { createLLMProvider } from '../../llm/LLMProvider.js';
import { createDevOps } from '../../agents/devops/DevOps.js';
import { createImplementer } from '../../agents/implementer/Implementer.js';
import { FileContext } from '../../context/FileContext.js';
import { createTask } from '../../tasks/Task.js';
import { formatArtifact } from '../../tasks/HandoffPayload.js';
import type { AgentResponse } from '../../agents/base/types.js';
import type { TaskContext, ProjectContext } from '../../tasks/types.js';
import { initializeMemory, closeMemory } from '../../memory/MemoryManager.js';
import { resetAgentRegistry } from '../../agents/base/AgentRegistry.js';

const DEFAULT_MAX_TRIES = 5;
const MAX_DEVOPS_CONTEXT_CHARS = 3000;
const MAX_IMPLEMENTER_CONTEXT_CHARS = 12000;
const MAX_PROFILE_CONTEXT_CHARS = 4000;

interface RepairOptions {
  tries?: string;
  verbose?: boolean;
  json?: boolean;
}

interface RepairStepResult {
  success: boolean;
  output: string;
  artifactCount: number;
  nextAction?: string;
}

interface RepairIterationResult {
  try: number;
  devops: RepairStepResult;
  implementer?: RepairStepResult;
}

export const repairCommand = new Command('repair')
  .description('Run a DevOps/Implementer repair loop to fix build errors in the current project')
  .option('-t, --tries <count>', `Maximum repair loops to run (default: ${DEFAULT_MAX_TRIES})`)
  .option('-v, --verbose', 'Enable verbose output')
  .option('-j, --json', 'Output results as JSON')
  .action(async (options: RepairOptions) => {
    try {
      await Config.load();
      const config = Config.get();

      if (options.verbose) {
        logger.setLevel('debug');
      }

      const maxTries = parseTriesOption(options.tries);

      if (!options.json) {
        logger.info(`Starting repair loop (max tries: ${maxTries})`);
        logger.blank();
      }

      initializeMemory(config.memory);

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
      const devops = createDevOps({ llmProvider });
      const implementer = createImplementer({ llmProvider });
      const fileContext = new FileContext({
        workingDirectory: projectContext.workingDirectory,
      });

      const taskContext: TaskContext = {
        parentTask: undefined,
        relatedTasks: [],
        projectContext,
        fileContext,
        executionHistory: [],
      };

      const iterations: RepairIterationResult[] = [];
      let latestImplementerOutput = '';
      let repairSucceeded = false;
      let projectProfile = '';

      if (!options.json) {
        logger.agent('devops', 'Initial run: identifying project type and tech stack');
      }

      projectProfile = await runInitialProjectProfile(devops, taskContext, options);

      if (options.verbose && !options.json) {
        logger.debug(`Project profile: ${truncateForLog(projectProfile, 800)}`);
      }

      for (let attempt = 1; attempt <= maxTries; attempt++) {
        if (!options.json) {
          logger.agent('devops', `Loop ${attempt}/${maxTries}: running build diagnostics`);
        }

        const devopsTask = createTask({
          goal: 'Build the current project and report any errors that block success.',
          description: 'Detect project type, run a build command, and return actionable error details.',
          handoff: {
            context: buildDevOpsContext(attempt, maxTries, latestImplementerOutput, projectProfile),
            constraints: [
              'Focus on build/compile errors and include exact failure details.',
              'If build fails, provide actionable errors for Implementer to fix.',
            ],
          },
        });

        const devopsResponse = await devops.execute(devopsTask, taskContext);
        const iteration: RepairIterationResult = {
          try: attempt,
          devops: createStepResult(devopsResponse),
        };

        if (options.verbose && !options.json) {
          logger.debug(`DevOps output (loop ${attempt}): ${truncateForLog(devopsResponse.output)}`);
        }

        if (devopsResponse.success) {
          repairSucceeded = true;
          iterations.push(iteration);

          if (!options.json) {
            logger.success(`Build succeeded on loop ${attempt}`);
          }
          break;
        }

        if (attempt === maxTries) {
          iterations.push(iteration);
          if (!options.json) {
            logger.error(`Build is still failing after ${maxTries} loop(s)`);
          }
          break;
        }

        if (!options.json) {
          logger.handoff('devops', 'implementer', 'Build failed - apply targeted fixes');
        }

        const implementerTask = createTask({
          goal: 'Fix the project based on DevOps build errors.',
          description: 'Apply minimal code changes to resolve current build failures.',
          handoff: {
            context: buildImplementerContext(attempt, maxTries, projectProfile, devopsResponse.output),
            constraints: [
              'Make targeted fixes for reported build errors.',
              'Avoid unrelated refactors unless required for build stability.',
            ],
            artifacts: devopsResponse.artifacts.map((artifact) => formatArtifact(artifact)),
          },
        });

        const implementerResponse = await implementer.execute(implementerTask, taskContext);
        latestImplementerOutput = implementerResponse.output;
        iteration.implementer = createStepResult(implementerResponse);
        iterations.push(iteration);

        if (options.verbose && !options.json) {
          logger.debug(`Implementer output (loop ${attempt}): ${truncateForLog(implementerResponse.output)}`);
        }
      }

      const payload = {
        success: repairSucceeded,
        maxTries,
        attempts: iterations.length,
        projectProfile,
        iterations,
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        logger.blank();
        logger.info(`Repair attempts: ${iterations.length}/${maxTries}`);
        if (repairSucceeded) {
          logger.success('Repair completed: build is passing');
        } else {
          logger.error('Repair incomplete: build still failing');
        }
      }

      if (!repairSucceeded) {
        process.exit(1);
      }
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

function parseTriesOption(triesOption?: string): number {
  if (!triesOption) {
    return DEFAULT_MAX_TRIES;
  }

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

async function runInitialProjectProfile(
  devops: ReturnType<typeof createDevOps>,
  taskContext: TaskContext,
  options: RepairOptions
): Promise<string> {
  const profileTask = createTask({
    goal: 'Identify project type, tech stack, and likely build/test commands.',
    description: 'Analyze the repository and provide stack context for the implementer before repairs begin.',
    handoff: {
      context: [
        'This is the first repair pass.',
        'Determine project type and tech stack so implementation starts with the right context.',
        'Use detect_project_type and inspect key config files as needed.',
      ].join(' '),
      constraints: [
        'Do not modify files.',
        'Include languages, frameworks, package/build tools, and likely build command(s).',
      ],
    },
  });

  const profileResponse = await devops.execute(profileTask, taskContext);

  if (!options.json) {
    logger.success('Captured project profile from DevOps');
  }

  return profileResponse.output;
}

function buildDevOpsContext(
  attempt: number,
  maxTries: number,
  latestImplementerOutput: string,
  projectProfile: string
): string {
  let context = `Repair loop ${attempt} of ${maxTries}. Build the current project and report any blocking errors.`;

  if (projectProfile.trim()) {
    context += '\n\nProject profile (from initial DevOps analysis):\n';
    context += truncateForContext(projectProfile, MAX_PROFILE_CONTEXT_CHARS);
  }

  if (latestImplementerOutput.trim()) {
    context += '\n\nLatest implementer summary:\n';
    context += truncateForContext(latestImplementerOutput, MAX_DEVOPS_CONTEXT_CHARS);
  }

  return context;
}

function buildImplementerContext(
  attempt: number,
  maxTries: number,
  projectProfile: string,
  devopsOutput: string
): string {
  return [
    `DevOps build failed during repair loop ${attempt} of ${maxTries}.`,
    'Use the error details below to fix the project so the next build can pass.',
    '',
    'Project profile from DevOps initial analysis:',
    truncateForContext(projectProfile, MAX_PROFILE_CONTEXT_CHARS),
    '',
    'DevOps output:',
    truncateForContext(devopsOutput, MAX_IMPLEMENTER_CONTEXT_CHARS),
  ].join('\n');
}

function truncateForContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...[truncated for context]`;
}

function truncateForLog(value: string, maxChars = 500): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

function resolveProjectName(workingDirectory: string): string {
  const derivedName = basename(workingDirectory).trim();
  return derivedName.length > 0 ? derivedName : 'current-project';
}
