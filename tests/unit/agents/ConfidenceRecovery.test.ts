import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ConfidenceRouter } from '../../../src/agents/orchestrator/ConfidenceRouter.js';
import { AgentRegistry } from '../../../src/agents/base/AgentRegistry.js';
import { Agent } from '../../../src/agents/base/Agent.js';
import { NoConfidentAgentError } from '../../../src/utils/errors.js';
import type { AgentConfig, ConfidenceScore } from '../../../src/agents/base/types.js';
import type { LLMProvider, LLMResponse } from '../../../src/llm/types.js';
import type { Task, TaskContext } from '../../../src/tasks/types.js';

// Mock LLM Provider
const createMockLLMProvider = (): LLMProvider => ({
  type: 'anthropic',
  model: 'test-model',
  complete: mock(() =>
    Promise.resolve({
      content: '{"confidence": 0.8, "reason": "Test reason"}',
      model: 'test',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      stopReason: 'end_turn',
    } as LLMResponse)
  ),
  isAvailable: mock(() => Promise.resolve(true)),
});

// Test agent implementation with controllable confidence
class TestAgent extends Agent {
  private assessTaskMock: ReturnType<typeof mock>;
  private getStatusMock: ReturnType<typeof mock>;
  private assessCallCount = 0;
  private assessResponses: ConfidenceScore[] = [];

  constructor(id: string, role: 'architect' | 'implementer' | 'reviewer' = 'implementer') {
    const config: AgentConfig = {
      id,
      role,
      capabilities: ['coding', 'testing'],
      confidenceThreshold: 0.6,
      maxRetries: 3,
    };
    super(config, { llmProvider: createMockLLMProvider() });

    this.assessTaskMock = mock(() => Promise.resolve({ confidence: 0.5, reason: 'Default' }));
    this.getStatusMock = mock(() => 'idle' as const);
  }

  get systemPrompt(): string {
    return 'Test agent prompt';
  }

  protected buildExecutionPrompt(): string {
    return 'Test execution prompt';
  }

  // Override assessTask to use our mock
  async assessTask(task: Task, context: TaskContext): Promise<ConfidenceScore> {
    if (this.assessResponses.length > this.assessCallCount) {
      const response = this.assessResponses[this.assessCallCount];
      this.assessCallCount++;
      return response!;
    }
    this.assessCallCount++;
    return this.assessTaskMock(task, context);
  }

  // Override getStatus to use our mock
  getStatus(): 'idle' | 'busy' | 'error' {
    return this.getStatusMock();
  }

  // Helper to set up sequential responses
  setAssessResponses(...responses: ConfidenceScore[]): void {
    this.assessResponses = responses;
    this.assessCallCount = 0;
  }

  // Helper to set single response
  setAssessResponse(response: ConfidenceScore): void {
    this.assessTaskMock = mock(() => Promise.resolve(response));
    this.assessResponses = [];
  }

  // Helper to make assessment throw
  setAssessError(error: Error): void {
    this.assessTaskMock = mock(() => Promise.reject(error));
    this.assessResponses = [];
  }

  // Helper to set status
  setStatus(status: 'idle' | 'busy' | 'error'): void {
    this.getStatusMock = mock(() => status);
  }

  // Get call count
  getAssessCallCount(): number {
    return this.assessCallCount;
  }

  // Reset call count
  resetCallCount(): void {
    this.assessCallCount = 0;
  }
}

// Helper to create a mock task
const createMockTask = (): Task => ({
  id: 'test-task-123',
  goal: 'Test goal',
  description: 'Test description',
  status: 'pending',
  priority: 'medium',
  attempts: [],
  dependencies: [],
  createdAt: new Date(),
  updatedAt: new Date(),
});

// Helper to create a mock context
const createMockContext = (): TaskContext => ({
  projectContext: {
    name: 'test-project',
    workingDirectory: '/test/dir',
    constraints: [],
  },
  executionHistory: [],
});

// Helper to create router with agents
const createRouter = (
  agents: Agent[],
  config: { recoveryEnabled?: boolean; confidenceThreshold?: number } = {}
): ConfidenceRouter => {
  const registry = new AgentRegistry();
  agents.forEach((agent) => registry.register(agent));
  return new ConfidenceRouter(registry, {
    confidenceThreshold: config.confidenceThreshold ?? 0.6,
    recoveryEnabled: config.recoveryEnabled ?? true,
    parallelAssessment: true,
  });
};

describe('Confidence Recovery', () => {
  let task: Task;
  let context: TaskContext;

  beforeEach(() => {
    task = createMockTask();
    context = createMockContext();
  });

  it('should attempt recovery when no agent meets threshold', async () => {
    // Setup: Agent returns 0.4 initially, 0.7 after recovery
    const mockAgent = new TestAgent('agent1');
    mockAgent.setAssessResponses(
      { confidence: 0.4, reason: 'Low confidence' },
      { confidence: 0.7, reason: 'Better with context' }
    );

    const router = createRouter([mockAgent], { recoveryEnabled: true });
    const result = await router.route(task, context);

    expect(result.recoveryAttempt?.attempted).toBe(true);
    expect(result.recoveryAttempt?.success).toBe(true);
    expect(result.score.confidence).toBe(0.7);
  });

  it('should select agent with lowest confidence for recovery', async () => {
    const highAgent = new TestAgent('high-agent');
    highAgent.setAssessResponse({ confidence: 0.5, reason: 'Medium' });

    const lowAgent = new TestAgent('low-agent');
    lowAgent.setAssessResponses(
      { confidence: 0.3, reason: 'Low' },
      { confidence: 0.7, reason: 'Enhanced' }
    );

    const router = createRouter([highAgent, lowAgent]);
    const result = await router.route(task, context);

    // lowAgent should be selected for recovery (called twice)
    expect(lowAgent.getAssessCallCount()).toBe(2);
    expect(highAgent.getAssessCallCount()).toBe(1);
    expect(result.selectedAgent.id).toBe('low-agent');
  });

  it('should still fail if recovery does not improve confidence', async () => {
    const mockAgent = new TestAgent('agent1');
    mockAgent.setAssessResponse({ confidence: 0.4, reason: 'Still low' });

    const router = createRouter([mockAgent]);

    await expect(router.route(task, context)).rejects.toThrow(NoConfidentAgentError);
  });

  it('should include recovery attempted flag in error', async () => {
    const mockAgent = new TestAgent('agent1');
    mockAgent.setAssessResponse({ confidence: 0.4, reason: 'Still low' });

    const router = createRouter([mockAgent], { recoveryEnabled: true });

    try {
      await router.route(task, context);
      throw new Error('Expected NoConfidentAgentError to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NoConfidentAgentError);
      expect((error as NoConfidentAgentError).recoveryAttempted).toBe(true);
      expect((error as NoConfidentAgentError).message).toContain('(recovery attempted)');
    }
  });

  it('should not attempt recovery when disabled', async () => {
    const mockAgent = new TestAgent('agent1');
    mockAgent.setAssessResponse({ confidence: 0.4, reason: 'Low' });

    const router = createRouter([mockAgent], { recoveryEnabled: false });

    await expect(router.route(task, context)).rejects.toThrow(NoConfidentAgentError);
    expect(mockAgent.getAssessCallCount()).toBe(1); // Only initial assessment
  });

  it('should skip busy agents during recovery candidate selection', async () => {
    const idleAgent = new TestAgent('idle-agent');
    idleAgent.setAssessResponses(
      { confidence: 0.4, reason: 'Low' },
      { confidence: 0.7, reason: 'Enhanced' }
    );

    const busyAgent = new TestAgent('busy-agent');
    busyAgent.setStatus('busy');
    busyAgent.setAssessResponse({ confidence: 0.3, reason: 'Lowest' });

    // busyAgent won't be included in initial assessment because route() filters by idle status
    // So we need to test that recovery candidate selection filters properly
    const router = createRouter([idleAgent, busyAgent]);
    const result = await router.route(task, context);

    // idleAgent should be selected for recovery
    expect(result.selectedAgent.id).toBe('idle-agent');
    expect(result.recoveryAttempt?.success).toBe(true);
  });

  it('should include original and enhanced scores in recovery result', async () => {
    const mockAgent = new TestAgent('agent1');
    mockAgent.setAssessResponses(
      { confidence: 0.4, reason: 'Initial' },
      { confidence: 0.7, reason: 'Enhanced' }
    );

    const router = createRouter([mockAgent]);
    const result = await router.route(task, context);

    expect(result.recoveryAttempt?.originalScore?.confidence).toBe(0.4);
    expect(result.recoveryAttempt?.enhancedScore?.confidence).toBe(0.7);
  });

  it('should proceed normally when agent meets threshold initially', async () => {
    const mockAgent = new TestAgent('agent1');
    mockAgent.setAssessResponse({ confidence: 0.8, reason: 'High confidence' });

    const router = createRouter([mockAgent]);
    const result = await router.route(task, context);

    // No recovery should be attempted
    expect(result.recoveryAttempt).toBeUndefined();
    expect(result.score.confidence).toBe(0.8);
    expect(mockAgent.getAssessCallCount()).toBe(1);
  });

  it('should handle recovery assessment errors gracefully', async () => {
    const mockAgent = new TestAgent('agent1');
    // First call returns low confidence, second throws
    mockAgent.setAssessResponses({ confidence: 0.4, reason: 'Low' });
    // After the first response is consumed, the next call will use the mock
    // We need a different approach - set an error after the first response

    // Create a custom agent that throws on second call
    let callCount = 0;
    const errorAgent = new TestAgent('error-agent');
    const originalAssess = errorAgent.assessTask.bind(errorAgent);
    errorAgent.assessTask = async (t: Task, c: TaskContext) => {
      callCount++;
      if (callCount === 1) {
        return { confidence: 0.4, reason: 'Low' };
      }
      throw new Error('Assessment failed');
    };

    const router = createRouter([errorAgent]);

    await expect(router.route(task, context)).rejects.toThrow(NoConfidentAgentError);
  });
});
