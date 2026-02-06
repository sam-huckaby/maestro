import { nanoid } from 'nanoid';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  HandoffPayload,
  TaskAttempt,
} from './types.js';

export interface CreateTaskOptions {
  goal: string;
  description?: string;
  priority?: TaskPriority;
  dependencies?: string[];
  handoff?: Partial<HandoffPayload>;
  metadata?: Record<string, unknown>;
}

export function createTask(options: CreateTaskOptions): Task {
  const now = new Date();

  return {
    id: nanoid(),
    goal: options.goal,
    description: options.description || options.goal,
    status: 'pending',
    priority: options.priority || 'medium',
    assignedTo: undefined,
    handoff: {
      task: options.goal,
      context: options.handoff?.context || '',
      constraints: options.handoff?.constraints || [],
      artifacts: options.handoff?.artifacts || [],
    },
    attempts: [],
    dependencies: options.dependencies || [],
    createdAt: now,
    updatedAt: now,
    completedAt: undefined,
    metadata: options.metadata || {},
  };
}

export function updateTaskStatus(task: Task, status: TaskStatus): Task {
  const updated: Task = {
    ...task,
    status,
    updatedAt: new Date(),
  };

  if (status === 'completed' || status === 'failed') {
    updated.completedAt = new Date();
  }

  return updated;
}

export function addTaskAttempt(task: Task, attempt: Omit<TaskAttempt, 'startedAt'>): Task {
  const newAttempt: TaskAttempt = {
    ...attempt,
    startedAt: new Date(),
  };

  return {
    ...task,
    attempts: [...task.attempts, newAttempt],
    updatedAt: new Date(),
  };
}

export function completeTaskAttempt(
  task: Task,
  success: boolean,
  output?: string,
  error?: string
): Task {
  const attempts = [...task.attempts];
  const lastAttempt = attempts[attempts.length - 1];

  if (lastAttempt) {
    attempts[attempts.length - 1] = {
      ...lastAttempt,
      completedAt: new Date(),
      success,
      output,
      error,
    };
  }

  return {
    ...task,
    attempts,
    updatedAt: new Date(),
  };
}

export function updateTaskHandoff(task: Task, handoff: Partial<HandoffPayload>): Task {
  return {
    ...task,
    handoff: {
      ...task.handoff,
      ...handoff,
    },
    updatedAt: new Date(),
  };
}

export function canStartTask(task: Task, completedTaskIds: Set<string>): boolean {
  if (task.status !== 'pending') {
    return false;
  }

  return task.dependencies.every((depId) => completedTaskIds.has(depId));
}

export function getTaskDuration(task: Task): number | undefined {
  if (!task.completedAt) return undefined;
  return task.completedAt.getTime() - task.createdAt.getTime();
}

export function getLastAttempt(task: Task): TaskAttempt | undefined {
  return task.attempts[task.attempts.length - 1];
}

export function getSuccessfulAttempts(task: Task): TaskAttempt[] {
  return task.attempts.filter((a) => a.success);
}

export function getFailedAttempts(task: Task): TaskAttempt[] {
  return task.attempts.filter((a) => !a.success);
}
