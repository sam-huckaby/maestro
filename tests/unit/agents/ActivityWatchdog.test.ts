import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  ActivityWatchdog,
  type WatchdogConfig,
  type ActivityEvent,
  getDefaultWatchdogConfig,
} from '../../../src/agents/orchestrator/ActivityWatchdog.js';

describe('ActivityWatchdog', () => {
  let watchdog: ActivityWatchdog;

  beforeEach(() => {
    watchdog = new ActivityWatchdog({
      activityTimeoutMs: 100, // Short timeout for tests
      checkIntervalMs: 50,
      maxHandoffCycles: 3,
      llmRequestGracePeriodMs: 200,
    });
  });

  afterEach(() => {
    watchdog.stop();
  });

  describe('activity tracking', () => {
    it('should record activity events', () => {
      const event: ActivityEvent = {
        type: 'llm_request_start',
        agentId: 'agent-1',
        taskId: 'task-1',
        timestamp: new Date(),
      };

      watchdog.recordActivity(event);
      // No error means success
    });

    it('should not record activity when disabled', () => {
      const disabledWatchdog = new ActivityWatchdog({ enabled: false });
      const event: ActivityEvent = {
        type: 'llm_request_start',
        agentId: 'agent-1',
        taskId: 'task-1',
        timestamp: new Date(),
      };

      disabledWatchdog.recordActivity(event);
      // No error, but activity is not tracked
    });
  });

  describe('stuck detection', () => {
    it('should emit agentStuck when no activity for configured timeout', async () => {
      watchdog.start();

      const stuckHandler = mock(() => {});
      watchdog.on('agentStuck', stuckHandler);

      // Record initial activity
      watchdog.recordActivity({
        type: 'llm_response_received',
        agentId: 'agent-1',
        taskId: 'task-1',
        timestamp: new Date(),
      });

      // Wait for timeout + check interval
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(stuckHandler).toHaveBeenCalled();
      const [agentId, taskId, lastActivityMs] = stuckHandler.mock.calls[0] as [string, string, number];
      expect(agentId).toBe('agent-1');
      expect(taskId).toBe('task-1');
      expect(lastActivityMs).toBeGreaterThanOrEqual(100);
    });

    it('should use grace period for LLM requests', async () => {
      watchdog.start();

      const stuckHandler = mock(() => {});
      watchdog.on('agentStuck', stuckHandler);

      // Record LLM request start (should use longer grace period)
      watchdog.recordActivity({
        type: 'llm_request_start',
        agentId: 'agent-1',
        taskId: 'task-1',
        timestamp: new Date(),
      });

      // Wait for normal timeout but not grace period
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should NOT be stuck yet because LLM grace period is 200ms
      expect(stuckHandler).not.toHaveBeenCalled();

      // Wait for grace period to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(stuckHandler).toHaveBeenCalled();
    });

    it('should reset LLM grace period when response received', async () => {
      watchdog.start();

      const stuckHandler = mock(() => {});
      watchdog.on('agentStuck', stuckHandler);

      // Start LLM request
      watchdog.recordActivity({
        type: 'llm_request_start',
        agentId: 'agent-1',
        taskId: 'task-1',
        timestamp: new Date(),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Complete LLM request - should reset to normal timeout
      watchdog.recordActivity({
        type: 'llm_response_received',
        agentId: 'agent-1',
        taskId: 'task-1',
        timestamp: new Date(),
      });

      // Wait past normal timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(stuckHandler).toHaveBeenCalled();
    });
  });

  describe('handoff cycle counting', () => {
    it('should count A->B->A as one handoff cycle', () => {
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');
      expect(watchdog.getHandoffCycleCount('task-1')).toBe(0);

      watchdog.recordHandoff('task-1', 'reviewer', 'implementer');
      expect(watchdog.getHandoffCycleCount('task-1')).toBe(0);

      // Now repeat implementer->reviewer (same pattern as first)
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');
      expect(watchdog.getHandoffCycleCount('task-1')).toBe(1);
    });

    it('should emit handoffCycleWarning at 80% of max', () => {
      const warningHandler = mock(() => {});
      watchdog.on('handoffCycleWarning', warningHandler);

      // With maxHandoffCycles=3, warning at 80% = 2.4 -> floor = 2
      // Each repeated transition pattern counts as a cycle
      // impl->rev (1st occurrence), rev->impl (1st occurrence), impl->rev (2nd - cycle 1)
      // rev->impl (2nd - cycle 2), impl->rev (3rd - cycle 3)

      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');
      expect(watchdog.getHandoffCycleCount('task-1')).toBe(0);

      watchdog.recordHandoff('task-1', 'reviewer', 'implementer');
      expect(watchdog.getHandoffCycleCount('task-1')).toBe(0);

      // Repeating impl->rev triggers cycle 1
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');
      expect(watchdog.getHandoffCycleCount('task-1')).toBe(1);

      // Repeating rev->impl triggers cycle 2 (warning at 80% of 3 = 2)
      watchdog.recordHandoff('task-1', 'reviewer', 'implementer');
      expect(watchdog.getHandoffCycleCount('task-1')).toBe(2);

      expect(warningHandler).toHaveBeenCalled();
      const [taskId, cycleCount, maxCycles] = warningHandler.mock.calls[0] as [string, number, number];
      expect(taskId).toBe('task-1');
      expect(cycleCount).toBe(2);
      expect(maxCycles).toBe(3);
    });

    it('should emit handoffCycleExceeded at maxHandoffCycles', () => {
      const exceededHandler = mock(() => {});
      watchdog.on('handoffCycleExceeded', exceededHandler);

      // Create enough handoffs to exceed limit (3 cycles)
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');
      watchdog.recordHandoff('task-1', 'reviewer', 'implementer');
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer'); // cycle 1
      watchdog.recordHandoff('task-1', 'reviewer', 'implementer'); // cycle 2 (reviewer->implementer repeated)
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer'); // cycle 3 (implementer->reviewer repeated again)

      expect(exceededHandler).toHaveBeenCalled();
      const [taskId, cycleCount] = exceededHandler.mock.calls[0] as [string, number];
      expect(taskId).toBe('task-1');
      expect(cycleCount).toBeGreaterThanOrEqual(3);
    });

    it('should correctly check isHandoffLimitExceeded', () => {
      expect(watchdog.isHandoffLimitExceeded('task-1')).toBe(false);

      // Create enough handoffs to exceed limit
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');
      watchdog.recordHandoff('task-1', 'reviewer', 'implementer');
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');
      watchdog.recordHandoff('task-1', 'reviewer', 'implementer');
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');

      expect(watchdog.isHandoffLimitExceeded('task-1')).toBe(true);
    });

    it('should return handoff history', () => {
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');
      watchdog.recordHandoff('task-1', 'reviewer', 'implementer');

      const history = watchdog.getHandoffHistory('task-1');
      expect(history).toEqual([
        { from: 'implementer', to: 'reviewer' },
        { from: 'reviewer', to: 'implementer' },
      ]);
    });
  });

  describe('AbortController', () => {
    it('should create AbortController that aborts on stuck detection', async () => {
      watchdog.start();

      const controller = watchdog.createAbortController('agent-1', 'task-1');
      expect(controller.signal.aborted).toBe(false);

      // Record activity then let it timeout
      watchdog.recordActivity({
        type: 'tool_execution_complete',
        agentId: 'agent-1',
        taskId: 'task-1',
        timestamp: new Date(),
      });

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(controller.signal.aborted).toBe(true);
    });

    it('should return existing AbortController via getAbortController', () => {
      const controller = watchdog.createAbortController('agent-1', 'task-1');
      const retrieved = watchdog.getAbortController('agent-1', 'task-1');
      expect(retrieved).toBe(controller);
    });

    it('should clear agent state when requested', () => {
      watchdog.createAbortController('agent-1', 'task-1');
      watchdog.recordActivity({
        type: 'llm_request_start',
        agentId: 'agent-1',
        taskId: 'task-1',
        timestamp: new Date(),
      });

      watchdog.clearAgent('agent-1', 'task-1');

      expect(watchdog.getAbortController('agent-1', 'task-1')).toBeUndefined();
    });
  });

  describe('start/stop', () => {
    it('should track running state', () => {
      expect(watchdog.isRunning()).toBe(false);
      watchdog.start();
      expect(watchdog.isRunning()).toBe(true);
      watchdog.stop();
      expect(watchdog.isRunning()).toBe(false);
    });

    it('should not start when disabled', () => {
      const disabledWatchdog = new ActivityWatchdog({ enabled: false });
      disabledWatchdog.start();
      expect(disabledWatchdog.isRunning()).toBe(false);
    });

    it('should clear state on stop', () => {
      watchdog.start();
      watchdog.createAbortController('agent-1', 'task-1');
      watchdog.recordHandoff('task-1', 'implementer', 'reviewer');

      watchdog.stop();

      expect(watchdog.getAbortController('agent-1', 'task-1')).toBeUndefined();
      expect(watchdog.getHandoffHistory('task-1')).toEqual([]);
    });
  });

  describe('getDefaultWatchdogConfig', () => {
    it('should return valid default config', () => {
      const config = getDefaultWatchdogConfig();

      expect(config.enabled).toBe(true);
      expect(config.activityTimeoutMs).toBe(30000);
      expect(config.checkIntervalMs).toBe(5000);
      expect(config.maxHandoffCycles).toBe(5);
      expect(config.gracePeriodsEnabled).toBe(true);
      expect(config.llmRequestGracePeriodMs).toBe(120000);
    });
  });
});
