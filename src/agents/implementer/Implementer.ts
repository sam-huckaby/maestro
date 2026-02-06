import { Agent, type AgentDependencies } from '../base/Agent.js';
import type { AgentConfig } from '../base/types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import {
  IMPLEMENTER_SYSTEM_PROMPT,
  IMPLEMENTER_EXECUTION_PROMPT_TEMPLATE,
} from './prompts.js';

export class Implementer extends Agent {
  constructor(dependencies: AgentDependencies, configOverrides?: Partial<AgentConfig>) {
    const config: AgentConfig = {
      id: configOverrides?.id ?? 'implementer',
      role: 'implementer',
      capabilities: ['coding', 'refactoring', 'debugging'],
      confidenceThreshold: configOverrides?.confidenceThreshold ?? 0.6,
      maxRetries: configOverrides?.maxRetries ?? 3,
    };
    super(config, dependencies);
  }

  get systemPrompt(): string {
    return IMPLEMENTER_SYSTEM_PROMPT;
  }

  protected buildExecutionPrompt(task: Task, context: TaskContext): string {
    const constraints = context.projectContext.constraints.length > 0
      ? context.projectContext.constraints.join('\n- ')
      : 'None specified';

    const handoffContext = task.handoff.context || 'No design specification provided';

    let prompt = IMPLEMENTER_EXECUTION_PROMPT_TEMPLATE
      .replace('{{goal}}', task.goal)
      .replace('{{description}}', task.description)
      .replace('{{projectName}}', context.projectContext.name)
      .replace('{{workingDirectory}}', context.projectContext.workingDirectory)
      .replace('{{constraints}}', constraints)
      .replace('{{handoffContext}}', handoffContext);

    // Include design artifacts
    if (task.handoff.artifacts.length > 0) {
      prompt += '\n\nDESIGN ARTIFACTS:\n';
      for (const artifact of task.handoff.artifacts) {
        prompt += `\n${artifact}\n`;
      }
    }

    // Include handoff constraints
    if (task.handoff.constraints.length > 0) {
      prompt += '\n\nIMPLEMENTATION CONSTRAINTS:\n- ';
      prompt += task.handoff.constraints.join('\n- ');
    }

    return prompt;
  }
}

export function createImplementer(dependencies: AgentDependencies): Implementer {
  return new Implementer(dependencies);
}
