import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AgentRegistry } from '../../../src/agents/base/AgentRegistry.js';
import { Agent } from '../../../src/agents/base/Agent.js';
import type { AgentConfig } from '../../../src/agents/base/types.js';
import type { LLMProvider, LLMResponse } from '../../../src/llm/types.js';

// Mock LLM Provider
const mockLLMProvider: LLMProvider = {
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
};

// Test agent implementation
class TestAgent extends Agent {
  constructor(id: string, role: 'architect' | 'implementer' | 'reviewer') {
    const config: AgentConfig = {
      id,
      role,
      capabilities: ['coding'],
      confidenceThreshold: 0.6,
      maxRetries: 3,
    };
    super(config, { llmProvider: mockLLMProvider });
  }

  get systemPrompt(): string {
    return 'Test agent prompt';
  }

  protected buildExecutionPrompt(): string {
    return 'Test execution prompt';
  }
}

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  describe('register', () => {
    it('should register an agent', () => {
      const agent = new TestAgent('agent1', 'implementer');
      registry.register(agent);

      expect(registry.get('agent1')).toBe(agent);
    });

    it('should index agents by role', () => {
      const agent1 = new TestAgent('agent1', 'implementer');
      const agent2 = new TestAgent('agent2', 'implementer');
      const agent3 = new TestAgent('agent3', 'reviewer');

      registry.register(agent1);
      registry.register(agent2);
      registry.register(agent3);

      expect(registry.getByRole('implementer')).toHaveLength(2);
      expect(registry.getByRole('reviewer')).toHaveLength(1);
    });
  });

  describe('unregister', () => {
    it('should remove an agent', () => {
      const agent = new TestAgent('agent1', 'implementer');
      registry.register(agent);

      const result = registry.unregister('agent1');

      expect(result).toBe(true);
      expect(registry.get('agent1')).toBeUndefined();
    });

    it('should return false for non-existent agent', () => {
      const result = registry.unregister('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all registered agents', () => {
      const agent1 = new TestAgent('agent1', 'implementer');
      const agent2 = new TestAgent('agent2', 'reviewer');

      registry.register(agent1);
      registry.register(agent2);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('getAllRoles', () => {
    it('should return all registered roles', () => {
      const agent1 = new TestAgent('agent1', 'implementer');
      const agent2 = new TestAgent('agent2', 'reviewer');

      registry.register(agent1);
      registry.register(agent2);

      const roles = registry.getAllRoles();
      expect(roles).toContain('implementer');
      expect(roles).toContain('reviewer');
    });
  });

  describe('hasRole', () => {
    it('should return true for registered role', () => {
      const agent = new TestAgent('agent1', 'implementer');
      registry.register(agent);

      expect(registry.hasRole('implementer')).toBe(true);
    });

    it('should return false for unregistered role', () => {
      expect(registry.hasRole('architect')).toBe(false);
    });
  });

  describe('count', () => {
    it('should return the number of agents', () => {
      registry.register(new TestAgent('agent1', 'implementer'));
      registry.register(new TestAgent('agent2', 'reviewer'));

      expect(registry.count()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all agents', () => {
      registry.register(new TestAgent('agent1', 'implementer'));
      registry.register(new TestAgent('agent2', 'reviewer'));

      registry.clear();

      expect(registry.count()).toBe(0);
    });
  });

  describe('getIdleAgents', () => {
    it('should return only idle agents', () => {
      const agent1 = new TestAgent('agent1', 'implementer');
      const agent2 = new TestAgent('agent2', 'reviewer');

      registry.register(agent1);
      registry.register(agent2);

      const idle = registry.getIdleAgents();
      expect(idle).toHaveLength(2);
    });
  });
});
