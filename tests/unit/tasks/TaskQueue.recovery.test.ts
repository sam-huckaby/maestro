import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { TaskQueue } from '../../../src/tasks/TaskQueue.js';
import { createTask, updateTaskStatus } from '../../../src/tasks/Task.js';

describe('TaskQueue - Recovery Support', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  describe('failedIds tracking', () => {
    it('should track failed task IDs', () => {
      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const failed = updateTaskStatus(task, 'failed');
      queue.update(failed);

      const failedIds = queue.getFailedIds();
      expect(failedIds.has(task.id)).toBe(true);
    });

    it('should clear failed IDs on remove', () => {
      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const failed = updateTaskStatus(task, 'failed');
      queue.update(failed);

      queue.remove(task.id);

      const failedIds = queue.getFailedIds();
      expect(failedIds.has(task.id)).toBe(false);
    });

    it('should clear failed IDs on clear', () => {
      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const failed = updateTaskStatus(task, 'failed');
      queue.update(failed);

      queue.clear();

      const failedIds = queue.getFailedIds();
      expect(failedIds.size).toBe(0);
    });
  });

  describe('hasFailedDependency', () => {
    it('should return false when no dependencies have failed', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      const result = queue.hasFailedDependency(task2);
      expect(result.failed).toBe(false);
      expect(result.failedDepId).toBeUndefined();
    });

    it('should return true when a dependency has failed', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      const failed = updateTaskStatus(task1, 'failed');
      queue.update(failed);

      const result = queue.hasFailedDependency(task2);
      expect(result.failed).toBe(true);
      expect(result.failedDepId).toBe(task1.id);
    });

    it('should identify the first failed dependency', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2' });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task1.id, task2.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      queue.update(updateTaskStatus(task1, 'failed'));
      queue.update(updateTaskStatus(task2, 'failed'));

      const result = queue.hasFailedDependency(task3);
      expect(result.failed).toBe(true);
      expect(result.failedDepId).toBe(task1.id); // First dependency that failed
    });
  });

  describe('getTransitiveDependents', () => {
    it('should return empty array for task with no dependents', () => {
      const task = createTask({ goal: 'Standalone task' });
      queue.add(task);

      const dependents = queue.getTransitiveDependents(task.id);
      expect(dependents).toHaveLength(0);
    });

    it('should return direct dependents', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      const dependents = queue.getTransitiveDependents(task1.id);
      expect(dependents).toHaveLength(2);
      expect(dependents.map((t) => t.id)).toContain(task2.id);
      expect(dependents.map((t) => t.id)).toContain(task3.id);
    });

    it('should return transitive dependents', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task2.id] });
      const task4 = createTask({ goal: 'Task 4', dependencies: [task3.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);
      queue.add(task4);

      const dependents = queue.getTransitiveDependents(task1.id);
      expect(dependents).toHaveLength(3);
      expect(dependents.map((t) => t.id)).toContain(task2.id);
      expect(dependents.map((t) => t.id)).toContain(task3.id);
      expect(dependents.map((t) => t.id)).toContain(task4.id);
    });

    it('should handle diamond dependencies without duplicates', () => {
      //     task1
      //    /     \
      // task2   task3
      //    \     /
      //     task4
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task1.id] });
      const task4 = createTask({ goal: 'Task 4', dependencies: [task2.id, task3.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);
      queue.add(task4);

      const dependents = queue.getTransitiveDependents(task1.id);
      expect(dependents).toHaveLength(3);
      // Each task should appear exactly once
      const ids = dependents.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('replaceWithRefinedTasks', () => {
    it('should remove failed task and add new tasks', () => {
      const task1 = createTask({ goal: 'Original task' });
      queue.add(task1);

      const newTask1 = createTask({ goal: 'Refined task 1' });
      const newTask2 = createTask({ goal: 'Refined task 2' });

      queue.replaceWithRefinedTasks(task1.id, [newTask1, newTask2], false);

      expect(queue.get(task1.id)).toBeUndefined();
      expect(queue.get(newTask1.id)).toBeDefined();
      expect(queue.get(newTask2.id)).toBeDefined();
      expect(queue.size()).toBe(2);
    });

    it('should remove transitive dependents when inheritDependents is true', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task2.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      const newTask = createTask({ goal: 'Refined task' });
      queue.replaceWithRefinedTasks(task1.id, [newTask], true);

      expect(queue.get(task1.id)).toBeUndefined();
      expect(queue.get(task2.id)).toBeUndefined();
      expect(queue.get(task3.id)).toBeUndefined();
      expect(queue.get(newTask.id)).toBeDefined();
      expect(queue.size()).toBe(1);
    });

    it('should preserve non-dependent tasks', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });
      const task3 = createTask({ goal: 'Unrelated task' });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      const newTask = createTask({ goal: 'Refined task' });
      queue.replaceWithRefinedTasks(task1.id, [newTask], true);

      expect(queue.get(task3.id)).toBeDefined();
      expect(queue.size()).toBe(2);
    });

    it('should emit taskReplanned event', () => {
      const task1 = createTask({ goal: 'Original task' });
      queue.add(task1);

      const handler = mock(() => {});
      queue.on('taskReplanned', handler);

      const newTask = createTask({ goal: 'Refined task' });
      queue.replaceWithRefinedTasks(task1.id, [newTask], false);

      expect(handler).toHaveBeenCalledWith(task1, [newTask]);
    });

    it('should do nothing for non-existent task', () => {
      const handler = mock(() => {});
      queue.on('taskReplanned', handler);

      queue.replaceWithRefinedTasks('non-existent', [createTask({ goal: 'New' })], false);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('cascadeFailure', () => {
    it('should mark all transitive dependents as failed', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task2.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      const failed = updateTaskStatus(task1, 'failed');
      queue.update(failed);

      const cascaded = queue.cascadeFailure(failed);

      expect(cascaded).toHaveLength(2);
      expect(queue.get(task2.id)?.status).toBe('failed');
      expect(queue.get(task3.id)?.status).toBe('failed');
    });

    it('should set failureInfo with dependency_failed reason', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      const failed = updateTaskStatus(task1, 'failed');
      queue.update(failed);

      queue.cascadeFailure(failed);

      const cascadedTask = queue.get(task2.id);
      expect(cascadedTask?.failureInfo?.reason).toBe('dependency_failed');
      expect(cascadedTask?.failureInfo?.failedDependency).toBe(task1.id);
      expect(cascadedTask?.failureInfo?.message).toContain(task1.goal);
    });

    it('should add cascaded tasks to failedIds', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      const failed = updateTaskStatus(task1, 'failed');
      queue.update(failed);

      queue.cascadeFailure(failed);

      const failedIds = queue.getFailedIds();
      expect(failedIds.has(task2.id)).toBe(true);
    });

    it('should emit taskCascadeFailed event for each cascaded task', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      const handler = mock(() => {});
      queue.on('taskCascadeFailed', handler);

      const failed = updateTaskStatus(task1, 'failed');
      queue.update(failed);

      queue.cascadeFailure(failed);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should only cascade pending tasks', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      // Mark task2 as completed before cascading
      queue.update(updateTaskStatus(task2, 'completed'));

      const failed = updateTaskStatus(task1, 'failed');
      queue.update(failed);

      const cascaded = queue.cascadeFailure(failed);

      expect(cascaded).toHaveLength(0);
      expect(queue.get(task2.id)?.status).toBe('completed'); // Should remain completed
    });
  });

  describe('getBlocked - doomed task exclusion', () => {
    it('should exclude tasks with failed dependencies from blocked list', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      // Initially task2 should be blocked
      expect(queue.getBlocked()).toHaveLength(1);

      // After task1 fails, task2 is "doomed" and should not count as blocked
      const failed = updateTaskStatus(task1, 'failed');
      queue.update(failed);

      expect(queue.getBlocked()).toHaveLength(0);
    });

    it('should still show tasks blocked by non-failed dependencies', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2' });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task1.id, task2.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      // Complete task1, fail task2
      queue.update(updateTaskStatus(task1, 'completed'));

      // task3 is still waiting for task2, which hasn't failed yet
      expect(queue.getBlocked()).toHaveLength(1);

      // Now fail task2
      queue.update(updateTaskStatus(task2, 'failed'));

      // task3 is now doomed, should not be blocked
      expect(queue.getBlocked()).toHaveLength(0);
    });
  });
});
