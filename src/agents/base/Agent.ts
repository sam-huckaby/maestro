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
  ActivityType,
  ActivityEvent,
} from './types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import type { LLMProvider, Message, ContentBlock } from '../../llm/types.js';
import { AgentError } from '../../utils/errors.js';
import { getMemoryManager } from '../../memory/MemoryManager.js';
import { ToolExecutor } from '../../tools/ToolExecutor.js';
import { FILE_TOOLS, FILE_WRITE_TOOLS } from '../../tools/types.js';
import type { ToolDefinition, ToolUse } from '../../tools/types.js';

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
  private activityCallback?: (event: ActivityEvent) => void;

  constructor(config: AgentConfig, dependencies: AgentDependencies) {
    this.id = config.id || nanoid();
    this.role = config.role;
    this.capabilities = config.capabilities;
    this.config = config;
    this.llm = dependencies.llmProvider;
  }

  /**
   * Set a callback to receive activity events during execution
   */
  setActivityCallback(callback: (event: ActivityEvent) => void): void {
    this.activityCallback = callback;
  }

  /**
   * Clear the activity callback
   */
  clearActivityCallback(): void {
    this.activityCallback = undefined;
  }

  /**
   * Report activity for watchdog tracking
   */
  protected reportActivity(type: ActivityType, metadata?: Record<string, unknown>): void {
    if (this.activityCallback && this.currentTaskId) {
      this.activityCallback({
        type,
        agentId: this.id,
        taskId: this.currentTaskId,
        timestamp: new Date(),
        metadata,
      });
    }
  }

  abstract get systemPrompt(): string;

  /**
   * Whether this agent can write files.
   * Override in subclasses to enable write permissions.
   */
  protected get canWriteFiles(): boolean {
    return false;
  }

  async assessTask(task: Task, context: TaskContext): Promise<ConfidenceScore> {
    const prompt = await this.buildAssessmentPrompt(task, context);

    try {
      const response = await this.llm.complete({
        system: this.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 500,
        temperature: 0.3,
      });

      // Extract text content from response
      const textContent = this.extractTextContent(response.content);
      return this.parseConfidenceResponse(textContent);
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
      const prompt = await this.buildExecutionPrompt(task, context);
      const memory = this.getMemory();

      // Store task context in short-term memory
      memory.shortTerm.set('current_task', { id: task.id, goal: task.goal });

      // Build initial conversation
      const messages: Message[] = this.buildConversation(prompt, task, context);

      // Get available tools for this agent
      const tools = this.getAvailableTools();

      // Create tool executor if we have file context
      const toolExecutor = context.fileContext
        ? new ToolExecutor(context.fileContext, this.canWriteFiles)
        : null;

      // Multi-turn loop for tool use
      let maxTurns = 10; // Prevent infinite loops
      let finalContent: string | ContentBlock[] = '';

      while (maxTurns > 0) {
        maxTurns--;

        // Report LLM request start
        this.reportActivity('llm_request_start');

        const response = await this.llm.complete({
          system: this.systemPrompt,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          maxTokens: 4096,
          temperature: 0.7,
        });

        // Report LLM response received
        this.reportActivity('llm_response_received');

        // If no tool use or no executor, we're done
        if (response.stopReason !== 'tool_use' || !toolExecutor) {
          finalContent = response.content;
          break;
        }

        // Handle tool calls
        const toolUses = this.extractToolUses(response.content);
        if (toolUses.length === 0) {
          finalContent = response.content;
          break;
        }

        // Report tool execution start
        this.reportActivity('tool_execution_start', { toolCount: toolUses.length });

        const toolResults = await Promise.all(
          toolUses.map((tu) => toolExecutor.execute(tu))
        );

        // Report tool execution complete
        this.reportActivity('tool_execution_complete', { toolCount: toolResults.length });

        // Add assistant response and tool results to conversation
        messages.push({ role: 'assistant', content: response.content as ContentBlock[] });
        messages.push({ role: 'user', content: toolResults });
      }

      // Extract text content for parsing
      const textContent = this.extractTextContent(finalContent);
      const result = this.parseExecutionResponse(textContent, task);

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

  /**
   * Get the tools available to this agent
   */
  protected getAvailableTools(): ToolDefinition[] {
    if (this.canWriteFiles) {
      return [...FILE_TOOLS, ...FILE_WRITE_TOOLS];
    }
    return FILE_TOOLS;
  }

  /**
   * Extract tool use blocks from response content
   */
  protected extractToolUses(content: string | ContentBlock[]): ToolUse[] {
    if (typeof content === 'string') {
      return [];
    }

    return content
      .filter((block): block is ToolUse => block.type === 'tool_use')
      .map((block) => ({
        type: 'tool_use' as const,
        id: block.id,
        name: block.name,
        input: block.input,
      }));
  }

  /**
   * Extract text content from response
   */
  protected extractTextContent(content: string | ContentBlock[]): string {
    if (typeof content === 'string') {
      return content;
    }

    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
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

  protected async buildAssessmentPrompt(task: Task, context: TaskContext): Promise<string> {
    let fileTreeSection = '';

    // Include file tree if available
    if (context.fileContext) {
      try {
        const fileTree = context.fileContext.formatTreeForPrompt(50);
        if (fileTree) {
          fileTreeSection = `
PROJECT FILES:
${fileTree}
`;
        }
      } catch {
        // Ignore file tree errors during assessment
      }
    }

    // Check for recovery hints in execution history
    const recoveryHint = context.executionHistory?.find((a) => a.agentId === 'system');
    const recoverySection = recoveryHint?.output
      ? `\nADDITIONAL GUIDANCE:\n${recoveryHint.output}\n`
      : '';

    // Check if partial solutions are acceptable
    const partialHint = context.projectContext.constraints.includes('Partial solutions are acceptable')
      ? '\n4. A partial solution is acceptable - focus on what you CAN do.'
      : '';

    return `
Assess your confidence in completing the following task.

Task: ${task.goal}
Description: ${task.description}

Context:
- Project: ${context.projectContext.name}
- Working Directory: ${context.projectContext.workingDirectory}
- Constraints: ${context.projectContext.constraints.join(', ') || 'None'}
${fileTreeSection}
Previous Attempts: ${task.attempts.length}

Your capabilities: ${this.capabilities.join(', ')}
${recoverySection}
Respond with a JSON object containing:
- confidence: A number between 0.0 and 1.0
- reason: A brief explanation of your confidence level

Consider:
1. Does this task match your capabilities?
2. Do you have the necessary context?
3. Are there any blockers or missing information?${partialHint}
`.trim();
  }

  protected abstract buildExecutionPrompt(task: Task, context: TaskContext): string | Promise<string>;

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
