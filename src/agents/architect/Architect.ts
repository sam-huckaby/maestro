import { Agent, type AgentDependencies } from '../base/Agent.js';
import type { AgentConfig, AgentResponse } from '../base/types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import {
  ARCHITECT_SYSTEM_PROMPT,
  ARCHITECT_EXECUTION_PROMPT_TEMPLATE,
} from './prompts.js';
import { logger } from '../../cli/ui/logger.js';

export class Architect extends Agent {
  constructor(dependencies: AgentDependencies, configOverrides?: Partial<AgentConfig>) {
    const config: AgentConfig = {
      id: configOverrides?.id ?? 'architect',
      role: 'architect',
      capabilities: ['design', 'planning', 'analysis'],
      confidenceThreshold: configOverrides?.confidenceThreshold ?? 0.6,
      maxRetries: configOverrides?.maxRetries ?? 3,
    };
    super(config, dependencies);
  }

  get systemPrompt(): string {
    return ARCHITECT_SYSTEM_PROMPT;
  }

  async execute(task: Task, context: TaskContext): Promise<AgentResponse> {
    logger.divider();
    logger.agent(this.role, `Starting design for: ${task.goal}`);

    const response = await super.execute(task, context);

    this.logDesignSummary(response, task);

    return response;
  }

  private logDesignSummary(response: AgentResponse, task: Task): void {
    if (!response.success) {
      logger.error(`Design failed for: ${task.goal}`);
      return;
    }

    const output = response.output;

    // Extract overview section
    const overviewMatch = output.match(/(?:overview|summary)[:\s]*\n?(.*?)(?=\n\n|$)/i);
    const overview = overviewMatch?.[1]?.trim().slice(0, 100) || 'Design completed';

    // Count components mentioned
    const componentMatches = output.match(/(?:component|service|module|class)[s]?[:\s]/gi);
    const componentCount = componentMatches?.length || 0;

    // Count interfaces mentioned
    const interfaceMatches = output.match(/(?:interface|api|contract|endpoint)[s]?[:\s]/gi);
    const interfaceCount = interfaceMatches?.length || 0;

    // Summarize artifacts by type
    const artifactSummary = this.summarizeArtifacts(response.artifacts);

    logger.agent(this.role, 'Design complete:');
    logger.info(`  Overview: ${overview}`);
    if (componentCount > 0) {
      logger.info(`  Components: ${componentCount} identified`);
    }
    if (interfaceCount > 0) {
      logger.info(`  Interfaces: ${interfaceCount} defined`);
    }
    if (response.artifacts.length > 0) {
      logger.info(`  Artifacts: ${response.artifacts.length} generated (${artifactSummary})`);
    }

    if (response.nextAction?.type === 'handoff') {
      logger.success(`Design handed off to ${response.nextAction.targetAgent}`);
    } else {
      logger.success('Design complete');
    }
    logger.divider();
  }

  private summarizeArtifacts(artifacts: AgentResponse['artifacts']): string {
    const typeCounts: Record<string, number> = {};
    for (const artifact of artifacts) {
      typeCounts[artifact.type] = (typeCounts[artifact.type] || 0) + 1;
    }
    return Object.entries(typeCounts)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');
  }

  protected async buildExecutionPrompt(task: Task, context: TaskContext): Promise<string> {
    const constraints = context.projectContext.constraints.length > 0
      ? context.projectContext.constraints.join('\n- ')
      : 'None specified';

    const handoffContext = task.handoff.context || 'No additional context provided';
    const handoffConstraints = task.handoff.constraints.length > 0
      ? task.handoff.constraints.join('\n- ')
      : '';

    let prompt = ARCHITECT_EXECUTION_PROMPT_TEMPLATE
      .replace('{{goal}}', task.goal)
      .replace('{{description}}', task.description)
      .replace('{{projectName}}', context.projectContext.name)
      .replace('{{workingDirectory}}', context.projectContext.workingDirectory)
      .replace('{{constraints}}', constraints)
      .replace('{{handoffContext}}', handoffContext);

    // Include file tree if available
    if (context.fileContext) {
      try {
        const fileTree = context.fileContext.formatTreeForPrompt(80);
        if (fileTree) {
          prompt += `\n\nPROJECT FILE STRUCTURE:\n${fileTree}`;
        }
      } catch {
        // Ignore file tree errors
      }
    }

    if (handoffConstraints) {
      prompt += `\n\nADDITIONAL CONSTRAINTS:\n- ${handoffConstraints}`;
    }

    // Include artifacts from previous work
    if (task.handoff.artifacts.length > 0) {
      prompt += `\n\nRELATED ARTIFACTS:\n${task.handoff.artifacts.join('\n')}`;
    }

    // Add tool usage instructions
    prompt += `\n\nTOOL USAGE:
You have access to the following tools to understand the existing codebase:
- read_file(path): Read the contents of a file to understand existing patterns
- find_files(pattern): Find files matching a glob pattern (e.g., "**/*.ts")

Use these tools to understand existing architecture before proposing designs.`;

    return prompt;
  }
}

export function createArchitect(dependencies: AgentDependencies): Architect {
  return new Architect(dependencies);
}
