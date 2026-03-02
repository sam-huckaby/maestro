import { Agent, type AgentDependencies } from '../base/Agent.js';
import type {
  AgentConfig,
  AgentResponse,
  Artifact,
  NextAction,
  ArtifactType,
} from '../base/types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import { DEVOPS_SYSTEM_PROMPT, DEVOPS_EXECUTION_PROMPT_TEMPLATE } from './prompts.js';

export interface BuildResult {
  success: boolean;
  exitCode: number;
  command: string;
  errors?: string[];
}

// --- Pure helper functions for parsing ---

function parseExitCode(response: string): number | null {
  const match = response.match(/Exit code:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function parseCommand(response: string): string | null {
  const match = response.match(/(?:Command|Executing|Running):\s*[`"]?([^`"\n]+)[`"]?/i);
  return match ? match[1].trim() : null;
}

function determineSuccess(response: string, exitCode: number | null): boolean {
  if (exitCode !== null) {
    return exitCode === 0;
  }

  const lower = response.toLowerCase();
  return !(lower.includes('failed') || lower.includes('error:') || lower.includes('build failed'));
}

function extractErrors(response: string): string[] {
  const errorLines = response.match(/(?:error|Error|ERROR)[:\s].*$/gm);
  return errorLines ? errorLines.slice(0, 10) : [];
}

function parseBuildResult(response: string, knownCommand?: string): BuildResult {
  const exitCode = parseExitCode(response);
  const command = knownCommand ?? parseCommand(response) ?? 'unknown';
  const success = determineSuccess(response, exitCode);
  const errors = extractErrors(response);

  return {
    success,
    exitCode: exitCode ?? (success ? 0 : 1),
    command,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function createBuildArtifact(taskId: string, buildResult: BuildResult): Artifact {
  return {
    id: `${taskId}_build_result`,
    type: 'test',
    name: 'build_result',
    content: JSON.stringify(buildResult, null, 2),
    metadata: {
      success: buildResult.success,
      exitCode: buildResult.exitCode,
      command: buildResult.command,
    },
  };
}

function extractCodeBlockArtifacts(
  taskId: string,
  response: string,
  inferType: (lang: string) => ArtifactType
): Artifact[] {
  const artifacts: Artifact[] = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  let index = 0;

  while ((match = codeBlockRegex.exec(response)) !== null) {
    const language = match[1] || 'text';
    const content = match[2]!.trim();
    if (language === 'json') continue;

    artifacts.push({
      id: `${taskId}_artifact_${index}`,
      type: inferType(language),
      name: `${language}_output_${index + 1}`,
      content,
      metadata: { language },
    });
    index++;
  }

  return artifacts;
}

function determineNextAction(success: boolean, response: string): NextAction | undefined {
  const lower = response.toLowerCase();

  if (!success) {
    const isHandoff =
      lower.includes('handoff to implementer') ||
      lower.includes('needs code changes') ||
      lower.includes('fix required');

    return isHandoff
      ? {
          type: 'handoff',
          targetAgent: 'implementer',
          reason: 'Build/test failed - code changes needed',
        }
      : { type: 'retry', reason: 'Build/test failed - may need retry or intervention' };
  }

  if (lower.includes('handoff to')) {
    const handoffMatch = response.match(/handoff to (\w+)/i);
    if (handoffMatch) {
      return {
        type: 'handoff',
        targetAgent: handoffMatch[1] as
          | 'orchestrator'
          | 'architect'
          | 'implementer'
          | 'reviewer'
          | 'devops',
        reason: 'Agent requested handoff',
      };
    }
  }

  if (lower.includes('complete') || success) {
    return {
      type: 'complete',
      reason: success ? 'Build/test completed successfully' : 'Task completed',
    };
  }

  return undefined;
}

// --- DevOps Agent class ---

export class DevOps extends Agent {
  constructor(dependencies: AgentDependencies, configOverrides?: Partial<AgentConfig>) {
    const config: AgentConfig = {
      id: configOverrides?.id ?? 'devops',
      role: 'devops',
      capabilities: ['testing', 'analysis'],
      confidenceThreshold: configOverrides?.confidenceThreshold ?? 0.6,
      maxRetries: configOverrides?.maxRetries ?? 3,
    };
    super(config, dependencies);
  }

  get systemPrompt(): string {
    return DEVOPS_SYSTEM_PROMPT;
  }

  protected get canWriteFiles(): boolean {
    return false;
  }

  protected get canRunCommands(): boolean {
    return true;
  }

  protected async buildExecutionPrompt(task: Task, context: TaskContext): Promise<string> {
    const constraints =
      context.projectContext.constraints.length > 0
        ? context.projectContext.constraints.join('\n- ')
        : 'None specified';

    const handoffContext = task.handoff.context || 'No context provided';

    let prompt = DEVOPS_EXECUTION_PROMPT_TEMPLATE.replace('{{goal}}', task.goal)
      .replace('{{description}}', task.description)
      .replace('{{projectName}}', context.projectContext.name)
      .replace('{{workingDirectory}}', context.projectContext.workingDirectory)
      .replace('{{constraints}}', constraints)
      .replace('{{handoffContext}}', handoffContext);

    prompt = this.appendFileTree(prompt, context);
    prompt = this.appendArtifacts(prompt, task);
    prompt = this.appendConstraints(prompt, task);

    return prompt;
  }

  private appendFileTree(prompt: string, context: TaskContext): string {
    if (!context.fileContext) return prompt;

    try {
      const fileTree = context.fileContext.formatTreeForPrompt(80);
      if (fileTree) {
        return `${prompt}\n\nPROJECT FILE STRUCTURE:\n${fileTree}`;
      }
    } catch {
      // Ignore file tree errors
    }
    return prompt;
  }

  private appendArtifacts(prompt: string, task: Task): string {
    if (task.handoff.artifacts.length === 0) return prompt;

    let result = `${prompt}\n\nARTIFACTS FROM PREVIOUS AGENT:\n`;
    for (const artifact of task.handoff.artifacts) {
      result += `\n${artifact}\n`;
    }
    return result;
  }

  private appendConstraints(prompt: string, task: Task): string {
    if (task.handoff.constraints.length === 0) return prompt;
    return `${prompt}\n\nCONSTRAINTS:\n- ${task.handoff.constraints.join('\n- ')}`;
  }

  protected parseExecutionResponse(response: string, task: Task): AgentResponse {
    const knownCommand = task.metadata.buildCommand as string | undefined;
    const buildResult = parseBuildResult(response, knownCommand);
    const buildArtifact = createBuildArtifact(task.id, buildResult);
    const codeArtifacts = extractCodeBlockArtifacts(task.id, response, (lang) =>
      this.inferArtifactType(lang)
    );
    const nextAction = determineNextAction(buildResult.success, response);

    return {
      success: buildResult.success,
      output: response,
      artifacts: [buildArtifact, ...codeArtifacts],
      metadata: {
        agentId: this.id,
        agentRole: this.role,
        timestamp: new Date().toISOString(),
        buildResult,
      },
      nextAction,
    };
  }
}

export function createDevOps(dependencies: AgentDependencies): DevOps {
  return new DevOps(dependencies);
}
