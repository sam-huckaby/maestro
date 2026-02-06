import { nanoid } from 'nanoid';
import type {
  AgentRole,
  AgentCapability,
  AgentConfig,
  AgentResponse,
  AgentMemoryView,
  ConfidenceScore,
  AgentStatus,
  Artifact,
  NextAction,
} from './types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import type { LLMProvider, Message } from '../../llm/types.js';
import { AgentError } from '../../utils/errors.js';
import { getMemoryManager } from '../../memory/MemoryManager.js';

export interface AgentDependencies {
  llmProvider: LLMProvider;
}

export abstract class Agent {
  readonly id: string;
  readonly role: AgentRole;
  readonly capabilities: AgentCapability[];

  protected llm: LLMProvider;
  protected config: AgentConfig;
  protected status: AgentStatus = 'idle';
  protected currentTaskId?: string;

  constructor(config: AgentConfig, dependencies: AgentDependencies) {
    this.id = config.id || nanoid();
    this.role = config.role;
    this.capabilities = config.capabilities;
    this.config = config;
    this.llm = dependencies.llmProvider;
  }

  abstract get systemPrompt(): string;

  async assessTask(task: Task, context: TaskContext): Promise<ConfidenceScore> {
    const prompt = this.buildAssessmentPrompt(task, context);

    try {
      const response = await this.llm.complete({
        system: this.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 500,
        temperature: 0.3,
      });

      return this.parseConfidenceResponse(response.content);
    } catch (error) {
      throw new AgentError(
        `Failed to assess task: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        this.role
      );
    }
  }

  async execute(task: Task, context: TaskContext): Promise<AgentResponse> {
    if (this.status === 'busy') {
      throw new AgentError('Agent is busy', this.id, this.role);
    }

    this.status = 'busy';
    this.currentTaskId = task.id;

    try {
      const prompt = this.buildExecutionPrompt(task, context);
      const memory = this.getMemory();

      // Store task context in short-term memory
      memory.shortTerm.set('current_task', { id: task.id, goal: task.goal });

      const response = await this.llm.complete({
        system: this.systemPrompt,
        messages: this.buildConversation(prompt, task, context),
        maxTokens: 4096,
        temperature: 0.7,
      });

      const result = this.parseExecutionResponse(response.content, task);

      // Store result in memory
      await memory.longTerm.set(`task_${task.id}_result`, {
        success: result.success,
        summary: result.output.slice(0, 500),
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      this.status = 'error';
      throw new AgentError(
        `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        this.role,
        { taskId: task.id }
      );
    } finally {
      this.status = 'idle';
      this.currentTaskId = undefined;
    }
  }

  getMemory(): AgentMemoryView {
    return getMemoryManager().getAgentView(this.id, this.role);
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  getCurrentTaskId(): string | undefined {
    return this.currentTaskId;
  }

  protected buildAssessmentPrompt(task: Task, context: TaskContext): string {
    return `
Assess your confidence in completing the following task.

Task: ${task.goal}
Description: ${task.description}

Context:
- Project: ${context.projectContext.name}
- Working Directory: ${context.projectContext.workingDirectory}
- Constraints: ${context.projectContext.constraints.join(', ') || 'None'}

Previous Attempts: ${task.attempts.length}

Your capabilities: ${this.capabilities.join(', ')}

Respond with a JSON object containing:
- confidence: A number between 0.0 and 1.0
- reason: A brief explanation of your confidence level

Consider:
1. Does this task match your capabilities?
2. Do you have the necessary context?
3. Are there any blockers or missing information?
`.trim();
  }

  protected abstract buildExecutionPrompt(task: Task, context: TaskContext): string;

  protected buildConversation(prompt: string, task: Task, _context: TaskContext): Message[] {
    const messages: Message[] = [];

    // Add context from previous attempts
    for (const attempt of task.attempts.slice(-3)) {
      if (attempt.output) {
        messages.push({
          role: 'assistant',
          content: `Previous attempt by ${attempt.agentRole}: ${attempt.output.slice(0, 1000)}`,
        });
      }
      if (attempt.error) {
        messages.push({
          role: 'user',
          content: `That attempt failed: ${attempt.error}`,
        });
      }
    }

    // Add the current prompt
    messages.push({ role: 'user', content: prompt });

    return messages;
  }

  protected parseConfidenceResponse(response: string): ConfidenceScore {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
          reason: parsed.reason ?? 'No reason provided',
        };
      }
    } catch {
      // Fall through to default
    }

    // Default response if parsing fails
    return {
      confidence: 0.5,
      reason: 'Could not parse confidence response',
    };
  }

  protected parseExecutionResponse(response: string, task: Task): AgentResponse {
    const artifacts: Artifact[] = [];
    let nextAction: NextAction | undefined;

    // Extract code blocks as artifacts
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    let artifactIndex = 0;

    while ((match = codeBlockRegex.exec(response)) !== null) {
      const language = match[1] || 'text';
      const content = match[2]!.trim();

      artifacts.push({
        id: `${task.id}_artifact_${artifactIndex++}`,
        type: this.inferArtifactType(language),
        name: `${language}_output_${artifactIndex}`,
        content,
        metadata: { language },
      });
    }

    // Check for next action indicators
    if (response.toLowerCase().includes('handoff to')) {
      const handoffMatch = response.match(/handoff to (\w+)/i);
      if (handoffMatch) {
        nextAction = {
          type: 'handoff',
          targetAgent: handoffMatch[1] as AgentRole,
          reason: 'Agent requested handoff',
        };
      }
    } else if (response.toLowerCase().includes('complete')) {
      nextAction = {
        type: 'complete',
        reason: 'Task completed successfully',
      };
    }

    return {
      success: true,
      output: response,
      artifacts,
      metadata: {
        agentId: this.id,
        agentRole: this.role,
        timestamp: new Date().toISOString(),
      },
      nextAction,
    };
  }

  protected inferArtifactType(
    language: string
  ): 'code' | 'design' | 'plan' | 'review' | 'documentation' | 'test' | 'config' {
    const codeLanguages = ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c', 'cpp'];
    const configLanguages = ['json', 'yaml', 'yml', 'toml', 'xml'];
    const docLanguages = ['markdown', 'md', 'txt'];

    if (codeLanguages.includes(language.toLowerCase())) return 'code';
    if (configLanguages.includes(language.toLowerCase())) return 'config';
    if (docLanguages.includes(language.toLowerCase())) return 'documentation';

    return 'code';
  }
}
