import { TaskQueue } from '../../../src/tasks/TaskQueue.js';
import { createTask, updateTaskStatus } from '../../../src/tasks/Task.js';

describe('TaskQueue - Deadlock Prevention', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  describe('reviewing status handling', () => {
    it('should include reviewing tasks in getReady()', () => {
      const task = createTask({ goal: 'Design something' });
      queue.add(task);
      queue.update(updateTaskStatus(task, 'reviewing'));

      const ready = queue.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0]?.status).toBe('reviewing');
    });

    it('should allow dependent tasks when dependency is reviewing', () => {
      const designTask = createTask({ goal: 'Design' });
      const implTask = createTask({ goal: 'Implement', dependencies: [designTask.id] });

      queue.add(designTask);
      queue.add(implTask);

      // Design task goes to reviewing (work done, awaiting review)
      queue.update(updateTaskStatus(designTask, 'reviewing'));

      // Implementation should now be unblocked
      const ready = queue.getReady();
      expect(ready).toHaveLength(2); // Both reviewing task and unblocked impl
      expect(ready.map(t => t.id)).toContain(implTask.id);
    });

    it('should not count reviewing tasks as blocked', () => {
      const task = createTask({ goal: 'Design' });
      queue.add(task);
      queue.update(updateTaskStatus(task, 'reviewing'));

      const blocked = queue.getBlocked();
      expect(blocked).toHaveLength(0);
    });

    it('should track reviewing task IDs', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);
      queue.update(updateTaskStatus(task, 'reviewing'));

      const reviewingIds = queue.getReviewingIds();
      expect(reviewingIds.has(task.id)).toBe(true);
    });

    it('should remove from reviewingIds when completed', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);
      queue.update(updateTaskStatus(task, 'reviewing'));
      expect(queue.getReviewingIds().has(task.id)).toBe(true);

      queue.update(updateTaskStatus(task, 'completed'));
      expect(queue.getReviewingIds().has(task.id)).toBe(false);
    });

    it('should remove from reviewingIds when failed', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);
      queue.update(updateTaskStatus(task, 'reviewing'));
      expect(queue.getReviewingIds().has(task.id)).toBe(true);

      queue.update(updateTaskStatus(task, 'failed'));
      expect(queue.getReviewingIds().has(task.id)).toBe(false);
    });

    it('should clear reviewingIds when queue is cleared', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);
      queue.update(updateTaskStatus(task, 'reviewing'));
      expect(queue.getReviewingIds().has(task.id)).toBe(true);

      queue.clear();
      expect(queue.getReviewingIds().size).toBe(0);
    });

    it('should remove from reviewingIds when task is removed', () => {
      const task = createTask({ goal: 'Test' });
      queue.add(task);
      queue.update(updateTaskStatus(task, 'reviewing'));
      expect(queue.getReviewingIds().has(task.id)).toBe(true);

      queue.remove(task.id);
      expect(queue.getReviewingIds().has(task.id)).toBe(false);
    });
  });

  describe('deadlock scenarios', () => {
    it('should not deadlock when design task goes to reviewing', () => {
      // Simulate the user's scenario
      const designTask = createTask({ goal: 'Design architecture' });
      const impl1 = createTask({ goal: 'Implement feature 1', dependencies: [designTask.id] });
      const impl2 = createTask({ goal: 'Implement feature 2', dependencies: [designTask.id] });
      const impl3 = createTask({ goal: 'Implement feature 3', dependencies: [designTask.id] });
      const reviewTask = createTask({
        goal: 'Review implementation',
        dependencies: [impl1.id, impl2.id, impl3.id]
      });

      queue.add(designTask);
      queue.add(impl1);
      queue.add(impl2);
      queue.add(impl3);
      queue.add(reviewTask);

      // Initial state: only design task is ready
      let ready = queue.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0]?.id).toBe(designTask.id);

      // Design task completes and goes to reviewing
      queue.update(updateTaskStatus(designTask, 'reviewing'));

      // Now: design (reviewing) + all impl tasks should be ready
      ready = queue.getReady();
      expect(ready.length).toBeGreaterThanOrEqual(4);

      // Blocked should NOT include impl tasks
      const blocked = queue.getBlocked();
      expect(blocked.map(t => t.id)).not.toContain(impl1.id);
      expect(blocked.map(t => t.id)).not.toContain(impl2.id);
      expect(blocked.map(t => t.id)).not.toContain(impl3.id);
    });

    it('should handle chain: design -> impl -> review correctly', () => {
      const design = createTask({ goal: 'Design' });
      const impl = createTask({ goal: 'Implement', dependencies: [design.id] });
      const review = createTask({ goal: 'Review', dependencies: [impl.id] });

      queue.add(design);
      queue.add(impl);
      queue.add(review);

      // Step 1: Design completes -> reviewing
      queue.update(updateTaskStatus(design, 'reviewing'));
      expect(queue.getReady().map(t => t.id)).toContain(impl.id);

      // Step 2: Impl completes -> reviewing
      queue.update(updateTaskStatus(impl, 'in_progress'));
      queue.update(updateTaskStatus(impl, 'reviewing'));
      expect(queue.getReady().map(t => t.id)).toContain(review.id);

      // Step 3: Review completes
      queue.update(updateTaskStatus(review, 'in_progress'));
      queue.update(updateTaskStatus(review, 'completed'));

      // Final review of earlier tasks
      queue.update(updateTaskStatus(design, 'completed'));
      queue.update(updateTaskStatus(impl, 'completed'));

      expect(queue.isComplete()).toBe(true);
    });

    it('should handle multiple levels of dependency with reviewing status', () => {
      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });
      const task3 = createTask({ goal: 'Task 3', dependencies: [task2.id] });

      queue.add(task1);
      queue.add(task2);
      queue.add(task3);

      // Task 1 goes to reviewing
      queue.update(updateTaskStatus(task1, 'reviewing'));

      // Task 2 should be ready
      let ready = queue.getReady();
      expect(ready.map(t => t.id)).toContain(task2.id);

      // Task 3 should still be blocked (task2 not yet done)
      let blocked = queue.getBlocked();
      expect(blocked.map(t => t.id)).toContain(task3.id);

      // Task 2 goes to reviewing
      queue.update(updateTaskStatus(task2, 'in_progress'));
      queue.update(updateTaskStatus(task2, 'reviewing'));

      // Task 3 should now be ready
      ready = queue.getReady();
      expect(ready.map(t => t.id)).toContain(task3.id);

      blocked = queue.getBlocked();
      expect(blocked).toHaveLength(0);
    });
  });
});
