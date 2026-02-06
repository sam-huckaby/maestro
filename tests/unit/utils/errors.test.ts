import {
  MaestroError,
  AgentError,
  TaskError,
  NoConfidentAgentError,
  LLMError,
  LLMRateLimitError,
  formatError,
  isRetryableError,
} from '../../../src/utils/errors.js';

describe('Errors', () => {
  describe('MaestroError', () => {
    it('should create error with code and context', () => {
      const error = new MaestroError('Test message', 'TEST_CODE', { key: 'value' });

      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.context).toEqual({ key: 'value' });
      expect(error.name).toBe('MaestroError');
    });

    it('should serialize to JSON', () => {
      const error = new MaestroError('Test', 'CODE');
      const json = error.toJSON();

      expect(json.name).toBe('MaestroError');
      expect(json.message).toBe('Test');
      expect(json.code).toBe('CODE');
    });
  });

  describe('AgentError', () => {
    it('should include agent information', () => {
      const error = new AgentError('Agent failed', 'agent123', 'implementer');

      expect(error.message).toBe('Agent failed');
      expect(error.agentId).toBe('agent123');
      expect(error.agentRole).toBe('implementer');
      expect(error.code).toBe('AGENT_ERROR');
    });
  });

  describe('TaskError', () => {
    it('should include task id', () => {
      const error = new TaskError('Task failed', 'task456');

      expect(error.message).toBe('Task failed');
      expect(error.taskId).toBe('task456');
      expect(error.code).toBe('TASK_ERROR');
    });
  });

  describe('NoConfidentAgentError', () => {
    it('should include assessments and threshold', () => {
      const assessments = [
        { agentId: 'a1', confidence: 0.4 },
        { agentId: 'a2', confidence: 0.3 },
      ];
      const error = new NoConfidentAgentError('task1', assessments, 0.6);

      expect(error.taskId).toBe('task1');
      expect(error.assessments).toEqual(assessments);
      expect(error.message).toContain('0.6');
    });
  });

  describe('LLMError', () => {
    it('should include provider', () => {
      const error = new LLMError('API failed', 'anthropic');

      expect(error.provider).toBe('anthropic');
      expect(error.code).toBe('LLM_ERROR');
    });
  });

  describe('LLMRateLimitError', () => {
    it('should include retry after', () => {
      const error = new LLMRateLimitError('anthropic', 5000);

      expect(error.provider).toBe('anthropic');
      expect(error.retryAfterMs).toBe(5000);
    });
  });

  describe('formatError', () => {
    it('should format MaestroError with code', () => {
      const error = new MaestroError('Test', 'TEST_CODE');
      expect(formatError(error)).toBe('[TEST_CODE] Test');
    });

    it('should format regular Error', () => {
      const error = new Error('Regular error');
      expect(formatError(error)).toBe('Regular error');
    });

    it('should format non-Error values', () => {
      expect(formatError('string error')).toBe('string error');
      expect(formatError(123)).toBe('123');
    });
  });

  describe('isRetryableError', () => {
    it('should return true for rate limit errors', () => {
      const error = new LLMRateLimitError('anthropic');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for LLM errors', () => {
      const error = new LLMError('API error', 'anthropic');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for task errors', () => {
      const error = new TaskError('Task failed', 'task1');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for agent errors', () => {
      const error = new AgentError('Agent error', 'a1', 'implementer');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Regular error');
      expect(isRetryableError(error)).toBe(false);
    });
  });
});
