import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ExecutionLoop, type ExecutionLoopConfig } from '../../../src/agents/orchestrator/ExecutionLoop.js';
import { TaskPlanner } from '../../../src/agents/orchestrator/TaskPlanner.js';
import { ConfidenceRouter } from '../../../src/agents/orchestrator/ConfidenceRouter.js';
import { AgentRegistry } from '../../../src/agents/base/AgentRegistry.js';
import { Agent } from '../../../src/agents/base/Agent.js';
import { TaskQueue } from '../../../src/tasks/TaskQueue.js';
import { createTask } from '../../../src/tasks/Task.js';
import { HandoffCycleLimitError, NoConfidentAgentError } from '../../../src/utils/errors.js';
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

// Test agent
class TestAgent extends Agent {
  private responseOverride?: AgentResponse;
  private assessConfidence = 0.8;
  private shouldFail = false;
  private failError?: Error;

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

  setResponseOverride(response: AgentResponse): void {
    this.responseOverride = response;
  }

  setAssessConfidence(confidence: number): void {
    this.assessConfidence = confidence;
  }

  setShouldFail(fail: boolean, error?: Error): void {
    this.shouldFail = fail;
    this.failError = error;
  }

  async assessTask(_task: Task, _context: TaskContext): Promise<ConfidenceScore> {
    return { confidence: this.assessConfidence, reason: 'Test assessment' };
  }

  async execute(_task: Task, _context: TaskContext): Promise<AgentResponse> {
    this.reportActivity('llm_request_start');

    if (this.shouldFail) {
      throw this.failError ?? new Error('Test failure');
    }

    this.reportActivity('llm_response_received');

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

// Mock TaskPlanner
class MockTaskPlanner {
  refineTaskMock = mock(() => Promise.resolve([] as Task[]));

  async refineTask(
    task: Task,
    feedback: string,
    projectContext: ProjectContext
  ): Promise<Task[]> {
    return this.refineTaskMock(task, feedback, projectContext);
  }
}

describe('ExecutionLoop - Recovery', () => {
  let queue: TaskQueue;
  let registry: AgentRegistry;
  let router: ConfidenceRouter;
  let projectContext: ProjectContext;
  let implementer: TestAgent;
  let reviewer: TestAgent;
  let mockPlanner: MockTaskPlanner;

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
      description: 'Test project',
      workingDirectory: '/tmp/test',
      constraints: [],
      preferences: {},
    };

    mockPlanner = new MockTaskPlanner();
  });

  const createLoopWithRecovery = (
    recoveryConfig?: Partial<ExecutionLoopConfig['recovery']>
  ): ExecutionLoop => {
    return new ExecutionLoop(
      queue,
      router,
      projectContext,
      {
        maxRetries: 1,
        taskTimeoutMs: 10000,
        reviewRequired: false,
        stuckDetection: {
          enabled: false,
          activityTimeoutMs: 5000,
          checkIntervalMs: 1000,
          maxHandoffCycles: 5,
          gracePeriodsEnabled: true,
          llmRequestGracePeriodMs: 10000,
        },
        recovery: {
          enabled: true,
          maxReplanAttempts: 2,
          cascadeOnReplanFailure: true,
          ...recoveryConfig,
        },
      },
      mockPlanner as unknown as TaskPlanner
    );
  };

  describe('recovery via replanning', () => {
    it('should attempt replanning when task fails', async () => {
      const loop = createLoopWithRecovery();

      implementer.setShouldFail(true);

      // Mock planner to return a refined task
      const refinedTask = createTask({ goal: 'Refined task' });
      mockPlanner.refineTaskMock.mockImplementation(() => Promise.resolve([refinedTask]));

      const task = createTask({ goal: 'Original task' });
      queue.add(task);

      const replanStartedHandler = mock(() => {});
      loop.on('taskReplanStarted', replanStartedHandler);

      await loop.run();

      expect(replanStartedHandler).toHaveBeenCalled();
      expect(mockPlanner.refineTaskMock).toHaveBeenCalled();
    });

    it('should replace failed task with refined tasks', async () => {
      const loop = createLoopWithRecovery();

      // First task fails, triggers replanning
      let callCount = 0;
      implementer.execute = async (_task: Task, _context: TaskContext) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First task failed');
        }
        return {
          success: true,
          output: 'Success',
          artifacts: [],
          metadata: {},
          nextAction: { type: 'complete', reason: 'Done' },
        };
      };

      const refinedTask1 = createTask({ goal: 'Refined task 1' });
      const refinedTask2 = createTask({ goal: 'Refined task 2' });
      mockPlanner.refineTaskMock.mockImplementation(() =>
        Promise.resolve([refinedTask1, refinedTask2])
      );

      const task = createTask({ goal: 'Original task' });
      queue.add(task);

      const replannedHandler = mock(() => {});
      loop.on('taskReplanned', replannedHandler);

      await loop.run();

      expect(replannedHandler).toHaveBeenCalled();
      const [oldTask, newTasks] = replannedHandler.mock.calls[0] as [Task, Task[]];
      expect(oldTask.id).toBe(task.id);
      expect(newTasks).toHaveLength(2);
    });

    it('should cascade-fail if replanning fails', async () => {
      const loop = createLoopWithRecovery();

      implementer.setShouldFail(true);

      // Mock planner to throw error
      mockPlanner.refineTaskMock.mockImplementation(() => {
        throw new Error('Replanning failed');
      });

      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      const replanFailedHandler = mock(() => {});
      const cascadeFailedHandler = mock(() => {});
      loop.on('taskReplanFailed', replanFailedHandler);
      loop.on('taskCascadeFailed', cascadeFailedHandler);

      await loop.run();

      expect(replanFailedHandler).toHaveBeenCalled();
      expect(cascadeFailedHandler).toHaveBeenCalled();
      expect(queue.get(task2.id)?.status).toBe('failed');
    });

    it('should respect maxReplanAttempts limit', async () => {
      const loop = createLoopWithRecovery({ maxReplanAttempts: 1 });

      implementer.setShouldFail(true);

      // Mock planner to return empty array (failure)
      mockPlanner.refineTaskMock.mockImplementation(() => Promise.resolve([]));

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      await loop.run();

      // Should only attempt replan once
      expect(mockPlanner.refineTaskMock).toHaveBeenCalledTimes(1);
    });

    it('should pass failure feedback to TaskPlanner', async () => {
      const loop = createLoopWithRecovery();

      const testError = new Error('Specific error message');
      implementer.setShouldFail(true, testError);

      mockPlanner.refineTaskMock.mockImplementation(() => Promise.resolve([]));

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      await loop.run();

      const [_task, feedback] = mockPlanner.refineTaskMock.mock.calls[0] as [Task, string, ProjectContext];
      expect(feedback).toContain('Specific error message');
      expect(feedback).toContain('execution_error');
    });

    it('should emit taskReplanned event on success', async () => {
      const loop = createLoopWithRecovery();

      let callCount = 0;
      implementer.execute = async (_task: Task, _context: TaskContext) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Task failed');
        }
        return {
          success: true,
          output: 'Success',
          artifacts: [],
          metadata: {},
          nextAction: { type: 'complete', reason: 'Done' },
        };
      };

      const refinedTask = createTask({ goal: 'Refined task' });
      mockPlanner.refineTaskMock.mockImplementation(() => Promise.resolve([refinedTask]));

      const task = createTask({ goal: 'Original task' });
      queue.add(task);

      const replannedHandler = mock(() => {});
      loop.on('taskReplanned', replannedHandler);

      await loop.run();

      expect(replannedHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit taskReplanFailed event on failure', async () => {
      const loop = createLoopWithRecovery();

      implementer.setShouldFail(true);

      mockPlanner.refineTaskMock.mockImplementation(() => {
        throw new Error('Replan failed');
      });

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const replanFailedHandler = mock(() => {});
      loop.on('taskReplanFailed', replanFailedHandler);

      await loop.run();

      expect(replanFailedHandler).toHaveBeenCalled();
      const [failedTask, error] = replanFailedHandler.mock.calls[0] as [Task, Error];
      expect(failedTask.id).toBe(task.id);
      expect(error.message).toContain('Replan failed');
    });
  });

  describe('recovery disabled', () => {
    it('should not attempt replanning when recovery is disabled', async () => {
      const loop = createLoopWithRecovery({ enabled: false });

      implementer.setShouldFail(true);

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      await loop.run();

      expect(mockPlanner.refineTaskMock).not.toHaveBeenCalled();
    });

    it('should not attempt replanning without TaskPlanner', async () => {
      // Create loop without TaskPlanner
      const loop = new ExecutionLoop(
        queue,
        router,
        projectContext,
        {
          maxRetries: 1,
          taskTimeoutMs: 10000,
          reviewRequired: false,
          stuckDetection: {
            enabled: false,
            activityTimeoutMs: 5000,
            checkIntervalMs: 1000,
            maxHandoffCycles: 5,
            gracePeriodsEnabled: true,
            llmRequestGracePeriodMs: 10000,
          },
          recovery: {
            enabled: true,
            maxReplanAttempts: 2,
            cascadeOnReplanFailure: true,
          },
        }
        // No TaskPlanner passed
      );

      implementer.setShouldFail(true);

      const task = createTask({ goal: 'Test task' });
      queue.add(task);

      const replanStartedHandler = mock(() => {});
      loop.on('taskReplanStarted', replanStartedHandler);

      await loop.run();

      expect(replanStartedHandler).not.toHaveBeenCalled();
    });
  });

  describe('failure reason handling', () => {
    it('should include handoff_limit reason for HandoffCycleLimitError', async () => {
      const loop = new ExecutionLoop(
        queue,
        router,
        projectContext,
        {
          maxRetries: 20,
          taskTimeoutMs: 10000,
          reviewRequired: false,
          stuckDetection: {
            enabled: true,
            activityTimeoutMs: 5000,
            checkIntervalMs: 1000,
            maxHandoffCycles: 2,
            gracePeriodsEnabled: true,
            llmRequestGracePeriodMs: 10000,
          },
          recovery: {
            enabled: true,
            maxReplanAttempts: 1,
            cascadeOnReplanFailure: true,
          },
        },
        mockPlanner as unknown as TaskPlanner
      );

      // Set up ping-pong handoffs
      implementer.execute = async (_task: Task, _context: TaskContext) => {
        return {
          success: true,
          output: 'Handing off',
          artifacts: [],
          metadata: {},
          nextAction: { type: 'handoff', targetAgent: 'reviewer', reason: 'Need review' },
        };
      };

      reviewer.execute = async (_task: Task, _context: TaskContext) => {
        return {
          success: true,
          output: 'Handing back',
          artifacts: [],
          metadata: {},
          nextAction: { type: 'handoff', targetAgent: 'implementer', reason: 'Need changes' },
        };
      };

      mockPlanner.refineTaskMock.mockImplementation(() => Promise.resolve([]));

      const task = createTask({ goal: 'Ping pong task' });
      queue.add(task);

      await loop.run();

      const [_task, feedback] = mockPlanner.refineTaskMock.mock.calls[0] as [Task, string, ProjectContext];
      expect(feedback).toContain('handoff_limit');
      expect(feedback).toContain('too many handoffs');
    });

    it('should include no_confident_agent reason for NoConfidentAgentError', async () => {
      // Make all agents have low confidence
      implementer.setAssessConfidence(0.1);
      reviewer.setAssessConfidence(0.1);

      const loop = createLoopWithRecovery();

      mockPlanner.refineTaskMock.mockImplementation(() => Promise.resolve([]));

      const task = createTask({ goal: 'Hard task' });
      queue.add(task);

      await loop.run();

      expect(mockPlanner.refineTaskMock).toHaveBeenCalled();
      const [_task, feedback] = mockPlanner.refineTaskMock.mock.calls[0] as [Task, string, ProjectContext];
      expect(feedback).toContain('no_confident_agent');
    });
  });

  describe('cascade failure behavior', () => {
    it('should not cascade when cascadeOnReplanFailure is false', async () => {
      const loop = createLoopWithRecovery({ cascadeOnReplanFailure: false });

      implementer.setShouldFail(true);

      mockPlanner.refineTaskMock.mockImplementation(() => {
        throw new Error('Replan failed');
      });

      // Only add a single task (no dependents) to avoid deadlock
      // When cascadeOnReplanFailure is false, tasks with failed deps remain pending
      const task = createTask({ goal: 'Task 1' });
      queue.add(task);

      const cascadeFailedHandler = mock(() => {});
      loop.on('taskCascadeFailed', cascadeFailedHandler);

      await loop.run();

      expect(cascadeFailedHandler).not.toHaveBeenCalled();
      expect(queue.get(task.id)?.status).toBe('failed');
    });

    it('should cascade failure to dependent tasks by default', async () => {
      const loop = createLoopWithRecovery({ cascadeOnReplanFailure: true });

      implementer.setShouldFail(true);

      mockPlanner.refineTaskMock.mockImplementation(() => {
        throw new Error('Replan failed');
      });

      const task1 = createTask({ goal: 'Task 1' });
      const task2 = createTask({ goal: 'Task 2', dependencies: [task1.id] });

      queue.add(task1);
      queue.add(task2);

      const cascadeFailedHandler = mock(() => {});
      loop.on('taskCascadeFailed', cascadeFailedHandler);

      await loop.run();

      expect(cascadeFailedHandler).toHaveBeenCalled();
      expect(queue.get(task2.id)?.status).toBe('failed');
      expect(queue.get(task2.id)?.failureInfo?.reason).toBe('dependency_failed');
    });
  });
});
