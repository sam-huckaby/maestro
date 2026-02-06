import type { MaestroConfig } from './types.js';
import { getDatabasePath } from '../utils/fs.js';

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_TASK_TIMEOUT_MS = 300000; // 5 minutes
export const DEFAULT_SHORT_TERM_MAX_SIZE = 1000;
export const DEFAULT_SHORT_TERM_TTL_MS = 3600000; // 1 hour

export function getDefaultConfig(): MaestroConfig {
  return {
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      temperature: 0.7,
      timeout: 60000,
    },
    memory: {
      shortTerm: {
        maxSize: DEFAULT_SHORT_TERM_MAX_SIZE,
        defaultTtlMs: DEFAULT_SHORT_TERM_TTL_MS,
      },
      longTerm: {
        databasePath: getDatabasePath('long_term'),
        walMode: true,
      },
      shared: {
        databasePath: getDatabasePath('shared'),
        namespaces: ['artifacts', 'decisions', 'context', 'errors'],
      },
    },
    agents: {
      orchestrator: {
        enabled: true,
        confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
        maxRetries: DEFAULT_MAX_RETRIES,
      },
      architect: {
        enabled: true,
        confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
        maxRetries: DEFAULT_MAX_RETRIES,
      },
      implementer: {
        enabled: true,
        confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
        maxRetries: DEFAULT_MAX_RETRIES,
      },
      reviewer: {
        enabled: true,
        confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
        maxRetries: DEFAULT_MAX_RETRIES,
      },
    },
    orchestration: {
      defaultConfidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
      maxTaskRetries: DEFAULT_MAX_RETRIES,
      taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
      parallelAssessment: true,
      reviewRequired: true,
    },
    cli: {
      colors: true,
      spinners: true,
      verbosity: 'info',
      outputFormat: 'text',
    },
    logging: {
      level: 'info',
      includeTimestamp: false,
      includeAgentId: true,
    },
  };
}

export function getConfigSearchPlaces(): string[] {
  return [
    'maestro.config.js',
    'maestro.config.json',
    '.maestrorc',
    '.maestrorc.json',
    '.maestrorc.js',
  ];
}

export function getEnvVariables(): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: 'llm.apiKey',
    MAESTRO_MODEL: 'llm.model',
    MAESTRO_DATA_DIR: 'memory.longTerm.databasePath',
    MAESTRO_LOG_LEVEL: 'logging.level',
    MAESTRO_CONFIDENCE_THRESHOLD: 'orchestration.defaultConfidenceThreshold',
  };
}
