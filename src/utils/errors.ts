export class MaestroError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'MaestroError';
    this.code = code;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack,
    };
  }
}

export class ConfigurationError extends MaestroError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', context);
    this.name = 'ConfigurationError';
  }
}

export class AgentError extends MaestroError {
  public readonly agentId: string;
  public readonly agentRole: string;

  constructor(
    message: string,
    agentId: string,
    agentRole: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'AGENT_ERROR', { ...context, agentId, agentRole });
    this.name = 'AgentError';
    this.agentId = agentId;
    this.agentRole = agentRole;
  }
}

export class NoConfidentAgentError extends MaestroError {
  public readonly taskId: string;
  public readonly assessments: Array<{ agentId: string; confidence: number }>;
  public readonly recoveryAttempted: boolean;

  constructor(
    taskId: string,
    assessments: Array<{ agentId: string; confidence: number }>,
    threshold: number,
    recoveryAttempted?: boolean
  ) {
    const recoveryNote = recoveryAttempted ? ' (recovery attempted)' : '';
    super(
      `No agent met confidence threshold ${threshold} for task ${taskId}${recoveryNote}`,
      'NO_CONFIDENT_AGENT',
      { taskId, assessments, threshold, recoveryAttempted }
    );
    this.name = 'NoConfidentAgentError';
    this.taskId = taskId;
    this.assessments = assessments;
    this.recoveryAttempted = recoveryAttempted ?? false;
  }
}

export class TaskError extends MaestroError {
  public readonly taskId: string;

  constructor(message: string, taskId: string, context?: Record<string, unknown>) {
    super(message, 'TASK_ERROR', { ...context, taskId });
    this.name = 'TaskError';
    this.taskId = taskId;
  }
}

export class TaskTimeoutError extends TaskError {
  constructor(taskId: string, timeoutMs: number) {
    super(`Task ${taskId} timed out after ${timeoutMs}ms`, taskId, { timeoutMs });
    this.name = 'TaskTimeoutError';
  }
}

export class AgentStuckError extends AgentError {
  constructor(
    agentId: string,
    agentRole: string,
    lastActivityMs: number,
    activityTimeoutMs: number
  ) {
    super(
      `Agent ${agentId} (${agentRole}) stuck - no activity for ${lastActivityMs}ms`,
      agentId,
      agentRole,
      { lastActivityMs, activityTimeoutMs }
    );
    this.name = 'AgentStuckError';
  }
}

export class HandoffCycleLimitError extends TaskError {
  public readonly handoffCount: number;
  public readonly maxHandoffs: number;
  public readonly history: Array<{ from: string; to: string }>;

  constructor(
    taskId: string,
    handoffCount: number,
    maxHandoffs: number,
    history: Array<{ from: string; to: string }>
  ) {
    super(
      `Task ${taskId} exceeded max handoff cycles (${handoffCount}/${maxHandoffs})`,
      taskId,
      { handoffCount, maxHandoffs, history }
    );
    this.name = 'HandoffCycleLimitError';
    this.handoffCount = handoffCount;
    this.maxHandoffs = maxHandoffs;
    this.history = history;
  }
}

export class DeadlockError extends TaskError {
  public readonly blockedCount: number;
  public readonly blockedTaskIds: string[];

  constructor(blockedCount: number, blockedTaskIds: string[]) {
    super(
      `Deadlock detected: ${blockedCount} blocked tasks with no tasks in progress`,
      blockedTaskIds[0] ?? 'unknown',
      { blockedCount, blockedTaskIds }
    );
    this.name = 'DeadlockError';
    this.blockedCount = blockedCount;
    this.blockedTaskIds = blockedTaskIds;
  }
}

export class TaskDependencyError extends TaskError {
  public readonly blockedBy: string[];

  constructor(taskId: string, blockedBy: string[]) {
    super(`Task ${taskId} is blocked by: ${blockedBy.join(', ')}`, taskId, { blockedBy });
    this.name = 'TaskDependencyError';
    this.blockedBy = blockedBy;
  }
}

export class MemoryError extends MaestroError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'MEMORY_ERROR', context);
    this.name = 'MemoryError';
  }
}

export class MemoryAccessError extends MemoryError {
  constructor(agentId: string, namespace: string) {
    super(`Agent ${agentId} does not have access to namespace ${namespace}`, {
      agentId,
      namespace,
    });
    this.name = 'MemoryAccessError';
  }
}

export class LLMError extends MaestroError {
  public readonly provider: string;

  constructor(message: string, provider: string, context?: Record<string, unknown>) {
    super(message, 'LLM_ERROR', { ...context, provider });
    this.name = 'LLMError';
    this.provider = provider;
  }
}

export class LLMRateLimitError extends LLMError {
  public readonly retryAfterMs?: number;

  constructor(provider: string, retryAfterMs?: number) {
    super(`Rate limited by ${provider}`, provider, { retryAfterMs });
    this.name = 'LLMRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class LLMAuthenticationError extends LLMError {
  constructor(provider: string) {
    super(`Authentication failed for ${provider}. Did you set the environment variable with your key?`, provider);
    this.name = 'LLMAuthenticationError';
  }
}

export class ValidationError extends MaestroError {
  public readonly field: string;
  public readonly value: unknown;

  constructor(message: string, field: string, value: unknown) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof LLMRateLimitError) return true;
  if (error instanceof TaskTimeoutError) return true;
  if (error instanceof AgentStuckError) return true;
  if (error instanceof MaestroError) {
    return ['LLM_ERROR', 'TASK_ERROR'].includes(error.code);
  }
  return false;
}

export function formatError(error: unknown): string {
  if (error instanceof MaestroError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
