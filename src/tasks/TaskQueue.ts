import { EventEmitter } from 'eventemitter3';
import type { Task, TaskStatus, TaskPriority } from './types.js';
import { canStartTask } from './Task.js';

export interface TaskQueueEvents {
  taskAdded: (task: Task) => void;
  taskUpdated: (task: Task) => void;
  taskCompleted: (task: Task) => void;
  taskFailed: (task: Task) => void;
  queueEmpty: () => void;
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
      this.emit('taskCompleted', task);
      this.checkQueueEmpty();
    } else if (task.status === 'failed') {
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
    return Array.from(this.tasks.values()).filter(
      (task) => canStartTask(task, this.completedIds)
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
    return Array.from(this.tasks.values()).filter(
      (task) =>
        task.status === 'pending' &&
        !canStartTask(task, this.completedIds)
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
  }

  remove(taskId: string): boolean {
    const removed = this.tasks.delete(taskId);
    this.completedIds.delete(taskId);
    return removed;
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
