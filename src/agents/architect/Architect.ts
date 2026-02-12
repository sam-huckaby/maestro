import { Agent, type AgentDependencies } from '../base/Agent.js';
import type { AgentConfig } from '../base/types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import {
  ARCHITECT_SYSTEM_PROMPT,
  ARCHITECT_EXECUTION_PROMPT_TEMPLATE,
} from './prompts.js';

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
