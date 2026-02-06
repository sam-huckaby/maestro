import { jest } from '@jest/globals';
import { TaskQueue } from '../../../src/tasks/TaskQueue.js';
import { createTask, updateTaskStatus } from '../../../src/tasks/Task.js';

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  describe('add', () => {
    it('should add a task to the queue', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);

      expect(queue.size()).toBe(1);
      expect(queue.get(task.id)).toEqual(task);
    });

    it('should emit taskAdded event', () => {
      const task = createTask({ goal: 'Test' });
      const handler = jest.fn();
      queue.on('taskAdded', handler);

      queue.add(task);

      expect(handler).toHaveBeenCalledWith(task);
    });
  });

  describe('update', () => {
    it('should update an existing task', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);

      const updated = updateTaskStatus(task, 'in_progress');
      queue.update(updated);

      expect(queue.get(task.id)?.status).toBe('in_progress');
    });

    it('should throw for non-existent task', () => {
      const task = createTask({ goal: 'Test' });
      expect(() => queue.update(task)).toThrow();
    });

    it('should emit taskCompleted for completed tasks', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);

      const handler = jest.fn();
      queue.on('taskCompleted', handler);

      const updated = updateTaskStatus(task, 'completed');
      queue.update(updated);

      expect(handler).toHaveBeenCalledWith(updated);
    });
  });

  describe('getNext', () => {
    it('should return undefined for empty queue', () => {
      expect(queue.getNext()).toBeUndefined();
    });

    it('should return the highest priority ready task', () => {
      const lowPriority = createTask({ goal: 'Low', priority: 'low' });
      const highPriority = createTask({ goal: 'High', priority: 'high' });

      queue.add(lowPriority);
      queue.add(highPriority);

      expect(queue.getNext()?.id).toBe(highPriority.id);
    });

    it('should not return tasks with unmet dependencies', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      const next = queue.getNext();
      expect(next?.id).toBe(task1.id);
    });

    it('should return dependent task after dependency is completed', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      // Complete task1
      const completed = updateTaskStatus(task1, 'completed');
      queue.update(completed);

      const next = queue.getNext();
      expect(next?.id).toBe(task2.id);
    });
  });

  describe('getReady', () => {
    it('should return all tasks with no dependencies', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2' });

      queue.add(task1);
      queue.add(task2);

      const ready = queue.getReady();
      expect(ready).toHaveLength(2);
    });

    it('should not include tasks with unmet dependencies', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      const ready = queue.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0]?.id).toBe(task1.id);
    });
  });

  describe('isComplete', () => {
    it('should return true for empty queue', () => {
      expect(queue.isComplete()).toBe(true);
    });

    it('should return false when tasks are pending', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);

      expect(queue.isComplete()).toBe(false);
    });

    it('should return true when all tasks are completed or failed', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2' });

      queue.add(task1);
      queue.add(task2);

      queue.update(updateTaskStatus(task1, 'completed'));
      queue.update(updateTaskStatus(task2, 'failed'));

      expect(queue.isComplete()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2' });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      queue.update(updateTaskStatus(task1, 'completed'));

      const stats = queue.getStats();
      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(2);
      expect(stats.blocked).toBe(0); // task3 is no longer blocked after task1 completed
    });
  });
});
