import {
  createTask,
  updateTaskStatus,
  addTaskAttempt,
  completeTaskAttempt,
  canStartTask,
  getTaskDuration,
  getLastAttempt,
} from '../../../src/tasks/Task.js';

describe('Task', () => {
  describe('createTask', () => {
    it('should create a task with required fields', () => {
      const task = createTask({ goal: 'Test goal' });

      expect(task.id).toBeDefined();
      expect(task.goal).toBe('Test goal');
      expect(task.description).toBe('Test goal');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('medium');
      expect(task.attempts).toEqual([]);
      expect(task.dependencies).toEqual([]);
    });

    it('should create a task with optional fields', () => {
      const task = createTask({
        goal: 'Test goal',
        description: 'Detailed description',
        priority: 'high',
        dependencies: ['dep1', 'dep2'],
        handoff: {
          context: 'Some context',
          constraints: ['constraint1'],
        },
        metadata: { key: 'value' },
      });

      expect(task.description).toBe('Detailed description');
      expect(task.priority).toBe('high');
      expect(task.dependencies).toEqual(['dep1', 'dep2']);
      expect(task.handoff.context).toBe('Some context');
      expect(task.handoff.constraints).toEqual(['constraint1']);
      expect(task.metadata).toEqual({ key: 'value' });
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status', () => {
      const task = createTask({ goal: 'Test' });
      const updated = updateTaskStatus(task, 'in_progress');

      expect(updated.status).toBe('in_progress');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(task.createdAt.getTime());
    });

    it('should set completedAt when status is completed', () => {
      const task = createTask({ goal: 'Test' });
      const updated = updateTaskStatus(task, 'completed');

      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeDefined();
    });

    it('should set completedAt when status is failed', () => {
      const task = createTask({ goal: 'Test' });
      const updated = updateTaskStatus(task, 'failed');

      expect(updated.status).toBe('failed');
      expect(updated.completedAt).toBeDefined();
    });
  });

  describe('addTaskAttempt', () => {
    it('should add an attempt to the task', () => {
      const task = createTask({ goal: 'Test' });
      const updated = addTaskAttempt(task, {
        agentId: 'agent1',
        agentRole: 'implementer',
        success: false,
        artifacts: [],
      });

      expect(updated.attempts).toHaveLength(1);
      expect(updated.attempts[0]?.agentId).toBe('agent1');
      expect(updated.attempts[0]?.agentRole).toBe('implementer');
      expect(updated.attempts[0]?.startedAt).toBeDefined();
    });
  });

  describe('completeTaskAttempt', () => {
    it('should complete the last attempt successfully', () => {
      let task = createTask({ goal: 'Test' });
      task = addTaskAttempt(task, {
        agentId: 'agent1',
        agentRole: 'implementer',
        success: false,
        artifacts: [],
      });

      const updated = completeTaskAttempt(task, true, 'Output text');

      expect(updated.attempts[0]?.success).toBe(true);
      expect(updated.attempts[0]?.output).toBe('Output text');
      expect(updated.attempts[0]?.completedAt).toBeDefined();
    });

    it('should complete the last attempt with failure', () => {
      let task = createTask({ goal: 'Test' });
      task = addTaskAttempt(task, {
        agentId: 'agent1',
        agentRole: 'implementer',
        success: false,
        artifacts: [],
      });

      const updated = completeTaskAttempt(task, false, undefined, 'Error message');

      expect(updated.attempts[0]?.success).toBe(false);
      expect(updated.attempts[0]?.error).toBe('Error message');
    });
  });

  describe('canStartTask', () => {
    it('should return true for task with no dependencies', () => {
      const task = createTask({ goal: 'Test' });
      expect(canStartTask(task, new Set())).toBe(true);
    });

    it('should return false for task with unmet dependencies', () => {
      const task = createTask({ goal: 'Test', dependencies: ['dep1', 'dep2'] });
      expect(canStartTask(task, new Set(['dep1']))).toBe(false);
    });

    it('should return true for task with all dependencies met', () => {
      const task = createTask({ goal: 'Test', dependencies: ['dep1', 'dep2'] });
      expect(canStartTask(task, new Set(['dep1', 'dep2']))).toBe(true);
    });

    it('should return false for non-pending task', () => {
      let task = createTask({ goal: 'Test' });
      task = updateTaskStatus(task, 'in_progress');
      expect(canStartTask(task, new Set())).toBe(false);
    });
  });

  describe('getTaskDuration', () => {
    it('should return undefined for incomplete task', () => {
      const task = createTask({ goal: 'Test' });
      expect(getTaskDuration(task)).toBeUndefined();
    });

    it('should return duration for completed task', () => {
      let task = createTask({ goal: 'Test' });
      task = updateTaskStatus(task, 'completed');

      const duration = getTaskDuration(task);
      expect(duration).toBeDefined();
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getLastAttempt', () => {
    it('should return undefined for task with no attempts', () => {
      const task = createTask({ goal: 'Test' });
      expect(getLastAttempt(task)).toBeUndefined();
    });

    it('should return the last attempt', () => {
      let task = createTask({ goal: 'Test' });
      task = addTaskAttempt(task, {
        agentId: 'agent1',
        agentRole: 'implementer',
        success: false,
        artifacts: [],
      });
      task = addTaskAttempt(task, {
        agentId: 'agent2',
        agentRole: 'reviewer',
        success: true,
        artifacts: [],
      });

      const last = getLastAttempt(task);
      expect(last?.agentId).toBe('agent2');
    });
  });
});
