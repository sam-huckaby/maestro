import { EventEmitter } from 'eventemitter3';
import type { Task, TaskStatus, TaskPriority } from './types.js';
import { canStartTask } from './Task.js';

export interface TaskQueueEvents {
  taskAdded: (task: Task) => void;
  taskUpdated: (task: Task) => void;
  taskCompleted: (task: Task) => void;
  taskFailed: (task: Task) => void;
  queueEmpty: () => void;
  taskCascadeFailed: (task: Task, failedDependency: Task) => void;
  taskReplanned: (oldTask: Task, newTasks: Task[]) => void;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export class TaskQueue extends EventEmitter<TaskQueueEvents> {
  private tasks: Map<string, Task> = new Map();
  private completedIds: Set<string> = new Set();
  private reviewingIds: Set<string> = new Set();
  private failedIds: Set<string> = new Set();

  add(task: Task): void {
    this.tasks.set(task.id, task);
    this.emit('taskAdded', task);
  }

  addMany(tasks: Task[]): void {
    for (const task of tasks) {
      this.add(task);
    }
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  update(task: Task): void {
    if (!this.tasks.has(task.id)) {
      throw new Error(`Task ${task.id} not found in queue`);
    }

    this.tasks.set(task.id, task);
    this.emit('taskUpdated', task);

    if (task.status === 'completed') {
      this.completedIds.add(task.id);
      this.reviewingIds.delete(task.id); // Remove from reviewing if it was there
      this.emit('taskCompleted', task);
      this.checkQueueEmpty();
    } else if (task.status === 'reviewing') {
      this.reviewingIds.add(task.id);
    } else if (task.status === 'failed') {
      this.failedIds.add(task.id); // Track failed task IDs
      this.reviewingIds.delete(task.id); // Remove from reviewing if it was there
      this.emit('taskFailed', task);
      this.checkQueueEmpty();
    }
  }

  getNext(): Task | undefined {
    const readyTasks = this.getReady();
    if (readyTasks.length === 0) return undefined;

    // Sort by priority (highest first), then by creation date (oldest first)
    readyTasks.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return readyTasks[0];
  }

  getReady(): Task[] {
    const satisfiedIds = new Set([...this.completedIds, ...this.reviewingIds]);
    return Array.from(this.tasks.values()).filter(
      (task) =>
        canStartTask(task, satisfiedIds) ||
        task.status === 'reviewing'
    );
  }

  getPending(): Task[] {
    return this.getByStatus('pending');
  }

  getInProgress(): Task[] {
    return this.getByStatus('in_progress');
  }

  getCompleted(): Task[] {
    return this.getByStatus('completed');
  }

  getFailed(): Task[] {
    return this.getByStatus('failed');
  }

  getBlocked(): Task[] {
    const satisfiedIds = new Set([...this.completedIds, ...this.reviewingIds]);
    return Array.from(this.tasks.values()).filter(
      (task) =>
        task.status === 'pending' &&
        !canStartTask(task, satisfiedIds) &&
        !this.hasFailedDependency(task).failed // Exclude doomed tasks
    );
  }

  getByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === status
    );
  }

  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  getCompletedIds(): Set<string> {
    return new Set(this.completedIds);
  }

  size(): number {
    return this.tasks.size;
  }

  pendingCount(): number {
    return this.getPending().length;
  }

  inProgressCount(): number {
    return this.getInProgress().length;
  }

  completedCount(): number {
    return this.completedIds.size;
  }

  isEmpty(): boolean {
    return this.tasks.size === 0;
  }

  isComplete(): boolean {
    const incomplete = Array.from(this.tasks.values()).filter(
      (task) => task.status !== 'completed' && task.status !== 'failed'
    );
    return incomplete.length === 0;
  }

  clear(): void {
    this.tasks.clear();
    this.completedIds.clear();
    this.reviewingIds.clear();
    this.failedIds.clear();
  }

  remove(taskId: string): boolean {
    const removed = this.tasks.delete(taskId);
    this.completedIds.delete(taskId);
    this.reviewingIds.delete(taskId);
    this.failedIds.delete(taskId);
    return removed;
  }

  getReviewingIds(): Set<string> {
    return new Set(this.reviewingIds);
  }

  getDependents(taskId: string): Task[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.dependencies.includes(taskId)
    );
  }

  getDependencies(taskId: string): Task[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];

    return task.dependencies
      .map((depId) => this.tasks.get(depId))
      .filter((t): t is Task => t !== undefined);
  }

  private checkQueueEmpty(): void {
    if (this.isComplete()) {
      this.emit('queueEmpty');
    }
  }

  getFailedIds(): Set<string> {
    return new Set(this.failedIds);
  }

  hasFailedDependency(task: Task): { failed: boolean; failedDepId?: string } {
    for (const depId of task.dependencies) {
      if (this.failedIds.has(depId)) {
        return { failed: true, failedDepId: depId };
      }
    }
    return { failed: false };
  }

  getTransitiveDependents(taskId: string): Task[] {
    const result: Task[] = [];
    const visited = new Set<string>();
    const collect = (id: string): void => {
      for (const dep of this.getDependents(id)) {
        if (!visited.has(dep.id)) {
          visited.add(dep.id);
          result.push(dep);
          collect(dep.id);
        }
      }
    };
    collect(taskId);
    return result;
  }

  replaceWithRefinedTasks(
    failedTaskId: string,
    newTasks: Task[],
    inheritDependents: boolean = true
  ): void {
    const failedTask = this.get(failedTaskId);
    if (!failedTask) return;

    // Get tasks that depended on the failed task
    const dependents = inheritDependents ? this.getTransitiveDependents(failedTaskId) : [];

    // Remove failed task and its dependents
    this.remove(failedTaskId);
    for (const dep of dependents) {
      this.remove(dep.id);
    }

    // Add new refined tasks
    for (const task of newTasks) {
      this.add(task);
    }

    // Emit event
    this.emit('taskReplanned', failedTask, newTasks);
  }

  cascadeFailure(failedTask: Task): Task[] {
    const cascaded: Task[] = [];
    for (const dependent of this.getTransitiveDependents(failedTask.id)) {
      if (dependent.status === 'pending') {
        const failed: Task = {
          ...dependent,
          status: 'failed' as const,
          failureInfo: {
            reason: 'dependency_failed' as const,
            message: `Dependency "${failedTask.goal}" failed and could not be replanned`,
            failedDependency: failedTask.id,
            timestamp: new Date(),
          },
        };
        this.tasks.set(dependent.id, failed);
        this.failedIds.add(dependent.id);
        cascaded.push(failed);
        this.emit('taskCascadeFailed', failed, failedTask);
      }
    }
    return cascaded;
  }

  getStats(): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    blocked: number;
  } {
    return {
      total: this.size(),
      pending: this.pendingCount(),
      inProgress: this.inProgressCount(),
      completed: this.completedCount(),
      failed: this.getFailed().length,
      blocked: this.getBlocked().length,
    };
  }
}
