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

  /**
   * Implementer has write permissions to create and modify files
   */
  protected get canWriteFiles(): boolean {
    return true;
  }

  protected async buildExecutionPrompt(task: Task, context: TaskContext): Promise<string> {
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

    // Add tool usage instructions
    prompt += `\n\nTOOL USAGE:
You have access to the following tools:

READ TOOLS:
- read_file(path): Read the contents of a file to understand existing code
- find_files(pattern): Find files matching a glob pattern (e.g., "**/*.ts")

WRITE TOOLS:
- write_file(path, content, overwrite?): Create or overwrite a file. IMPORTANT: You MUST read the file first before overwriting unless overwrite=true.
- edit_file(path, old_content, new_content): Make targeted edits using search/replace. MUST read file first. old_content must exactly match.
- restore_file(path): Restore a file from backup if a write went wrong.

WORKFLOW:
1. Use find_files to discover relevant files
2. Use read_file to understand existing code patterns
3. Use write_file to create new files or edit_file to modify existing ones
4. If you make a mistake, use restore_file to undo

RESTRICTIONS:
- Cannot write to .env, credentials, or other sensitive files
- Cannot write to node_modules/, .git/, or lock files`;

    return prompt;
  }
}

export function createImplementer(dependencies: AgentDependencies): Implementer {
  return new Implementer(dependencies);
}
