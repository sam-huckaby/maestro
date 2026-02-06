export {
  createTask,
  updateTaskStatus,
  addTaskAttempt,
  completeTaskAttempt,
  updateTaskHandoff,
  canStartTask,
  getTaskDuration,
  getLastAttempt,
  getSuccessfulAttempts,
  getFailedAttempts,
  type CreateTaskOptions,
} from './Task.js';

export { TaskQueue, type TaskQueueEvents } from './TaskQueue.js';

export {
  createHandoffPayload,
  updateHandoffWithResponse,
  formatArtifact,
  createHandoffFromTask,
  mergeHandoffs,
  summarizeAttempts,
} from './HandoffPayload.js';

export type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskResult,
  TaskContext,
  TaskAttempt,
  HandoffPayload,
  ProjectContext,
  TaskDecomposition,
} from './types.js';
