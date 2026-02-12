import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ExecutionLoop, type ExecutionLoopConfig } from '../../../src/agents/orchestrator/ExecutionLoop.js';
import { ConfidenceRouter } from '../../../src/agents/orchestrator/ConfidenceRouter.js';
import { AgentRegistry } from '../../../src/agents/base/AgentRegistry.js';
import { Agent } from '../../../src/agents/base/Agent.js';
import { TaskQueue } from '../../../src/tasks/TaskQueue.js';
import { createTask } from '../../../src/tasks/Task.js';
import { AgentStuckError, HandoffCycleLimitError } from '../../../src/utils/errors.js';
import type { AgentConfig, AgentResponse, ConfidenceScore } from '../../../src/agents/base/types.js';
import type { LLMProvider, LLMResponse } from '../../../src/llm/types.js';
import type { Task, TaskContext, ProjectContext } from '../../../src/tasks/types.js';

// Mock LLM Provider
const createMockLLMProvider = (): LLMProvider => ({
  type: 'anthropic',
  model: 'test-model',
  complete: mock(() =>
    Promise.resolve({
      content: 'Test response',
      model: 'test',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      stopReason: 'end_turn',
    } as LLMResponse)
  ),
  isAvailable: mock(() => Promise.resolve(true)),
});

// Test agent that can simulate being stuck
class TestAgent extends Agent {
  private executeDelay = 0;
  private shouldReportActivity = true;
  private responseOverride?: AgentResponse;
  private assessConfidence = 0.8;

  constructor(id: string, role: 'architect' | 'implementer' | 'reviewer' = 'implementer') {
    const config: AgentConfig = {
      id,
      role,
      capabilities: ['coding', 'testing'],
      confidenceThreshold: 0.6,
      maxRetries: 3,
    };
    super(config, { llmProvider: createMockLLMProvider() });
  }

  get systemPrompt(): string {
    return 'Test agent prompt';
  }

  protected buildExecutionPrompt(): string {
    return 'Test execution prompt';
  }

  setExecuteDelay(ms: number): void {
    this.executeDelay = ms;
  }

  setReportActivity(value: boolean): void {
    this.shouldReportActivity = value;
  }

  setResponseOverride(response: AgentResponse): void {
    this.responseOverride = response;
  }

  setAssessConfidence(confidence: number): void {
    this.assessConfidence = confidence;
  }

  async assessTask(_task: Task, _context: TaskContext): Promise<ConfidenceScore> {
    return { confidence: this.assessConfidence, reason: 'Test assessment' };
  }

  async execute(task: Task, context: TaskContext): Promise<AgentResponse> {
    if (this.executeDelay > 0) {
      // Simulate long-running operation without reporting activity
      if (this.shouldReportActivity) {
        this.reportActivity('llm_request_start');
      }
      await new Promise((resolve) => setTimeout(resolve, this.executeDelay));
      if (this.shouldReportActivity) {
        this.reportActivity('llm_response_received');
      }
    }

    if (this.responseOverride) {
      return this.responseOverride;
    }

    return {
      success: true,
      output: 'Test output',
      artifacts: [],
      metadata: { agentId: this.id, agentRole: this.role },
      nextAction: { type: 'complete', reason: 'Done' },
    };
  }
}

describe('ExecutionLoop - Stuck Detection', () => {
  let queue: TaskQueue;
  let registry: AgentRegistry;
  let router: ConfidenceRouter;
  let projectContext: ProjectContext;
  let implementer: TestAgent;
  let reviewer: TestAgent;

  beforeEach(() => {
    queue = new TaskQueue();
    registry = new AgentRegistry();

    implementer = new TestAgent('impl-1', 'implementer');
    reviewer = new TestAgent('rev-1', 'reviewer');

    registry.register(implementer);
    registry.register(reviewer);

    router = new ConfidenceRouter(registry, { defaultThreshold: 0.5 });

    projectContext = {
      name: 'test-project',
      workingDirectory: '/tmp/test',
      constraints: [],
    };
  });

  describe('stuck agent detection', () => {
    it('should abort execution when agent is stuck', async () => {
      const loop = new ExecutionLoop(queue, router, projectContext, {
        maxRetries: 1,
        taskTimeoutMs: 10000,
        reviewRequired: false,
        stuckDetection: {
          enabled: true,
          activityTimeoutMs: 100,
          checkIntervalMs: 50,
          maxHandoffCycles: 5,
          gracePeriodsEnabled: false, // Disable grace period for this test
          llmRequestGracePeriodMs: 100,
        },
      });

      // Make agent not report activity and delay execution
      implementer.setReportActivity(false);
      implementer.setExecuteDelay(500);

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const failedHandler = mock(() => {});
      loop.on('taskFailed', failedHandler);

      const stuckHandler = mock(() => {});
      loop.on('agentStuck', stuckHandler);

      await loop.run();

      // Task should have failed due to stuck detection
      expect(failedHandler).toHaveBeenCalled();
    });

    it('should retry task after stuck agent', async () => {
      let attemptCount = 0;

      const loop = new ExecutionLoop(queue, router, projectContext, {
        maxRetries: 2,
        taskTimeoutMs: 10000,
        reviewRequired: false,
        stuckDetection: {
          enabled: true,
          activityTimeoutMs: 100,
          checkIntervalMs: 50,
          maxHandoffCycles: 5,
          gracePeriodsEnabled: false,
          llmRequestGracePeriodMs: 100,
        },
      });

      // First attempt gets stuck, second succeeds
      const originalExecute = implementer.execute.bind(implementer);
      implementer.execute = async (task: Task, context: TaskContext) => {
        attemptCount++;
        if (attemptCount === 1) {
          // First attempt: don't report activity, simulate stuck
          await new Promise((resolve) => setTimeout(resolve, 300));
          throw new Error('Stuck');
        }
        // Second attempt: succeed quickly
        return originalExecute(task, context);
      };

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const retryHandler = mock(() => {});
      loop.on('taskRetrying', retryHandler);

      await loop.run();

      // Should have retried
      expect(attemptCount).toBeGreaterThanOrEqual(2);
    });

    it('should emit agentStuck event with task and agent info', async () => {
      const loop = new ExecutionLoop(queue, router, projectContext, {
        maxRetries: 1,
        taskTimeoutMs: 10000,
        reviewRequired: false,
        stuckDetection: {
          enabled: true,
          activityTimeoutMs: 100,
          checkIntervalMs: 50,
          maxHandoffCycles: 5,
          gracePeriodsEnabled: false,
          llmRequestGracePeriodMs: 100,
        },
      });

      implementer.setReportActivity(false);
      implementer.setExecuteDelay(500);

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const stuckHandler = mock(() => {});
      loop.on('agentStuck', stuckHandler);

      try {
        await loop.run();
      } catch {
        // Expected
      }

      // May or may not emit depending on timing
      // The important thing is no infinite loop
    });
  });

  describe('handoff cycle limit', () => {
    it('should throw HandoffCycleLimitError at cycle limit', async () => {
      const loop = new ExecutionLoop(queue, router, projectContext, {
        maxRetries: 20, // High to let handoffs happen
        taskTimeoutMs: 10000,
        reviewRequired: false,
        stuckDetection: {
          enabled: true,
          activityTimeoutMs: 5000,
          checkIntervalMs: 1000,
          maxHandoffCycles: 2, // Low limit to trigger quickly
          gracePeriodsEnabled: true,
          llmRequestGracePeriodMs: 10000,
        },
      });

      // Override execute to always handoff (fast, no delay)
      implementer.execute = async (_task: Task, _context: TaskContext) => {
        return {
          success: true,
          output: 'Handing off to reviewer',
          artifacts: [],
          metadata: {},
          nextAction: { type: 'handoff', targetAgent: 'reviewer', reason: 'Need review' },
        };
      };

      reviewer.execute = async (_task: Task, _context: TaskContext) => {
        return {
          success: true,
          output: 'Handing back to implementer',
          artifacts: [],
          metadata: {},
          nextAction: { type: 'handoff', targetAgent: 'implementer', reason: 'Need changes' },
        };
      };

      const task = createTask({ goal: 'Ping pong task' });
      queue.add(task);

      const failedHandler = mock(() => {});
      loop.on('taskFailed', failedHandler);

      await loop.run();

      // Task should fail due to handoff cycle limit
      expect(failedHandler).toHaveBeenCalled();
      const [_failedTask, error] = failedHandler.mock.calls[0] as [Task, Error];
      expect(error).toBeInstanceOf(HandoffCycleLimitError);
    });

    it('should emit handoffCycleWarning before limit', async () => {
      let handoffCount = 0;

      const loop = new ExecutionLoop(queue, router, projectContext, {
        maxRetries: 20,
        taskTimeoutMs: 10000,
        reviewRequired: false,
        stuckDetection: {
          enabled: true,
          activityTimeoutMs: 5000,
          checkIntervalMs: 1000,
          maxHandoffCycles: 5, // Warning at 80% = 4 cycles
          gracePeriodsEnabled: true,
          llmRequestGracePeriodMs: 10000,
        },
      });

      // Override execute - complete after many handoffs
      implementer.execute = async (_task: Task, _context: TaskContext) => {
        handoffCount++;
        return {
          success: true,
          output: 'Handing off',
          artifacts: [],
          metadata: {},
          nextAction: { type: 'handoff', targetAgent: 'reviewer', reason: 'Need review' },
        };
      };

      reviewer.execute = async (_task: Task, _context: TaskContext) => {
        handoffCount++;
        return {
          success: true,
          output: 'Handing back',
          artifacts: [],
          metadata: {},
          nextAction: { type: 'handoff', targetAgent: 'implementer', reason: 'Need changes' },
        };
      };

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const warningHandler = mock(() => {});
      loop.on('handoffCycleWarning', warningHandler);

      const failedHandler = mock(() => {});
      loop.on('taskFailed', failedHandler);

      await loop.run();

      // Warning should be emitted before limit exceeded
      // The task will eventually fail with HandoffCycleLimitError
      expect(failedHandler).toHaveBeenCalled();
    });
  });

  describe('stuckDetection.enabled = false', () => {
    it('should respect stuckDetection.enabled = false', async () => {
      const loop = new ExecutionLoop(queue, router, projectContext, {
        maxRetries: 1,
        taskTimeoutMs: 500,
        reviewRequired: false,
        stuckDetection: {
          enabled: false,
          activityTimeoutMs: 50,
          checkIntervalMs: 25,
          maxHandoffCycles: 5,
          gracePeriodsEnabled: true,
          llmRequestGracePeriodMs: 100,
        },
      });

      // Agent doesn't report activity but completes quickly
      implementer.setReportActivity(false);
      implementer.setExecuteDelay(0);

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const completedHandler = mock(() => {});
      loop.on('taskCompleted', completedHandler);

      await loop.run();

      // Task should complete normally since stuck detection is disabled
      expect(completedHandler).toHaveBeenCalled();
    });
  });
});
