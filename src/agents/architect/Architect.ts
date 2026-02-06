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

  protected buildExecutionPrompt(task: Task, context: TaskContext): string {
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

    if (handoffConstraints) {
      prompt += `\n\nADDITIONAL CONSTRAINTS:\n- ${handoffConstraints}`;
    }

    // Include artifacts from previous work
    if (task.handoff.artifacts.length > 0) {
      prompt += `\n\nRELATED ARTIFACTS:\n${task.handoff.artifacts.join('\n')}`;
    }

    return prompt;
  }
}

export function createArchitect(dependencies: AgentDependencies): Architect {
  return new Architect(dependencies);
}
