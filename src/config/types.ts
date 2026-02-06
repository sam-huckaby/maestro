import { z } from 'zod';
import type { LLMConfig } from '../llm/types.js';
import type { MemoryManagerConfig } from '../memory/types.js';
import type { AgentRole } from '../agents/base/types.js';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export interface AgentConfigOverride {
  enabled: boolean;
  confidenceThreshold?: number;
  maxRetries?: number;
  customPrompt?: string;
}

export interface MaestroConfig {
  llm: LLMConfig;
  memory: MemoryManagerConfig;
  agents: Record<AgentRole, AgentConfigOverride>;
  orchestration: OrchestrationConfig;
  cli: CliConfig;
  logging: LoggingConfig;
}

export interface OrchestrationConfig {
  defaultConfidenceThreshold: number;
  maxTaskRetries: number;
  taskTimeoutMs: number;
  parallelAssessment: boolean;
  reviewRequired: boolean;
}

export interface CliConfig {
  colors: boolean;
  spinners: boolean;
  verbosity: LogLevel;
  outputFormat: 'text' | 'json';
}

export interface LoggingConfig {
  level: LogLevel;
  file?: string;
  includeTimestamp: boolean;
  includeAgentId: boolean;
}

export interface ConfigSource {
  path: string;
  type: 'file' | 'env' | 'default';
}

export interface ResolvedConfig extends MaestroConfig {
  sources: ConfigSource[];
}
