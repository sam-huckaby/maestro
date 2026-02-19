import { Agent, type AgentDependencies } from '../base/Agent.js';
import type { AgentConfig, AgentResponse, Artifact, NextAction } from '../base/types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import {
  DEVOPS_SYSTEM_PROMPT,
  DEVOPS_EXECUTION_PROMPT_TEMPLATE,
} from './prompts.js';

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

  /**
   * DevOps does NOT have write permissions
   */
  protected get canWriteFiles(): boolean {
    return false;
  }

  /**
   * DevOps CAN run commands
   */
  protected get canRunCommands(): boolean {
    return true;
  }

  protected async buildExecutionPrompt(task: Task, context: TaskContext): Promise<string> {
    const constraints = context.projectContext.constraints.length > 0
      ? context.projectContext.constraints.join('\n- ')
      : 'None specified';

    const handoffContext = task.handoff.context || 'No context provided';

    let prompt = DEVOPS_EXECUTION_PROMPT_TEMPLATE
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

    // Include artifacts from handoff
    if (task.handoff.artifacts.length > 0) {
      prompt += '\n\nARTIFACTS FROM PREVIOUS AGENT:\n';
      for (const artifact of task.handoff.artifacts) {
        prompt += `\n${artifact}\n`;
      }
    }

    // Include handoff constraints
    if (task.handoff.constraints.length > 0) {
      prompt += '\n\nCONSTRAINTS:\n- ';
      prompt += task.handoff.constraints.join('\n- ');
    }

    return prompt;
  }

  /**
   * Custom response parsing for build/test results
   */
  protected parseExecutionResponse(response: string, task: Task): AgentResponse {
    const artifacts: Artifact[] = [];
    let nextAction: NextAction | undefined;
    let success = true;

    // Parse for build/test results
    const buildResult = this.parseBuildResult(response);

    // Create artifact with build result
    if (buildResult) {
      artifacts.push({
        id: `${task.id}_build_result`,
        type: 'test',
        name: 'build_result',
        content: JSON.stringify(buildResult, null, 2),
        metadata: {
          success: buildResult.success,
          exitCode: buildResult.exitCode,
          command: buildResult.command,
        },
      });

      success = buildResult.success;
    }

    // Extract code blocks as additional artifacts
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    let artifactIndex = 0;

    while ((match = codeBlockRegex.exec(response)) !== null) {
      const language = match[1] || 'text';
      const content = match[2]!.trim();

      // Skip JSON blocks (already parsed as build result)
      if (language === 'json') continue;

      artifacts.push({
        id: `${task.id}_artifact_${artifactIndex++}`,
        type: this.inferArtifactType(language),
        name: `${language}_output_${artifactIndex}`,
        content,
        metadata: { language },
      });
    }

    // Determine next action
    if (!success) {
      // Build failed - check if we should handoff to implementer
      if (response.toLowerCase().includes('handoff to implementer') ||
          response.toLowerCase().includes('needs code changes') ||
          response.toLowerCase().includes('fix required')) {
        nextAction = {
          type: 'handoff',
          targetAgent: 'implementer',
          reason: 'Build/test failed - code changes needed',
        };
      } else {
        nextAction = {
          type: 'retry',
          reason: 'Build/test failed - may need retry or intervention',
        };
      }
    } else if (response.toLowerCase().includes('handoff to')) {
      const handoffMatch = response.match(/handoff to (\w+)/i);
      if (handoffMatch) {
        nextAction = {
          type: 'handoff',
          targetAgent: handoffMatch[1] as 'orchestrator' | 'architect' | 'implementer' | 'reviewer' | 'devops',
          reason: 'Agent requested handoff',
        };
      }
    } else if (response.toLowerCase().includes('complete') || success) {
      nextAction = {
        type: 'complete',
        reason: success ? 'Build/test completed successfully' : 'Task completed',
      };
    }

    return {
      success,
      output: response,
      artifacts,
      metadata: {
        agentId: this.id,
        agentRole: this.role,
        timestamp: new Date().toISOString(),
        buildResult: buildResult || undefined,
      },
      nextAction,
    };
  }

  /**
   * Parse build/test result from response
   */
  private parseBuildResult(response: string): BuildResult | null {
    // Look for exit code patterns
    const exitCodeMatch = response.match(/Exit code:\s*(\d+)/i);
    const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : null;

    // Look for command executed
    const commandMatch = response.match(/(?:Command|Executing|Running):\s*[`"]?([^`"\n]+)[`"]?/i);
    const command = commandMatch ? commandMatch[1].trim() : null;

    // Determine success based on exit code or keywords
    let success = true;
    if (exitCode !== null) {
      success = exitCode === 0;
    } else if (
      response.toLowerCase().includes('failed') ||
      response.toLowerCase().includes('error:') ||
      response.toLowerCase().includes('build failed')
    ) {
      success = false;
    }

    // Extract error messages if present
    const errors: string[] = [];
    const errorLines = response.match(/(?:error|Error|ERROR)[:\s].*$/gm);
    if (errorLines) {
      errors.push(...errorLines.slice(0, 10)); // Limit to first 10 errors
    }

    return {
      success,
      exitCode: exitCode ?? (success ? 0 : 1),
      command: command ?? 'unknown',
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

interface BuildResult {
  success: boolean;
  exitCode: number;
  command: string;
  errors?: string[];
}

export function createDevOps(dependencies: AgentDependencies): DevOps {
  return new DevOps(dependencies);
}
