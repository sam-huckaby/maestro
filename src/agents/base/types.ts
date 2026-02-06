import { z } from 'zod';

export const AgentRoleSchema = z.enum(['orchestrator', 'architect', 'implementer', 'reviewer']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AgentCapabilitySchema = z.enum([
  'planning',
  'design',
  'coding',
  'review',
  'testing',
  'documentation',
  'refactoring',
  'debugging',
  'analysis',
  'coordination',
]);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const ConfidenceScoreSchema = z.object({
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type ConfidenceScore = z.infer<typeof ConfidenceScoreSchema>;

export const AgentStatusSchema = z.enum(['idle', 'busy', 'error']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export interface AgentConfig {
  id: string;
  role: AgentRole;
  capabilities: AgentCapability[];
  confidenceThreshold: number;
  maxRetries: number;
}

export interface AgentResponse {
  success: boolean;
  output: string;
  artifacts: Artifact[];
  metadata: Record<string, unknown>;
  nextAction?: NextAction;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export const ArtifactTypeSchema = z.enum([
  'code',
  'design',
  'plan',
  'review',
  'documentation',
  'test',
  'config',
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export interface NextAction {
  type: 'continue' | 'handoff' | 'complete' | 'retry' | 'escalate';
  targetAgent?: AgentRole;
  reason: string;
}

export interface AgentMemoryView {
  shortTerm: ShortTermView;
  longTerm: LongTermView;
  shared: SharedView;
}

export interface ShortTermView {
  get(key: string): unknown;
  set(key: string, value: unknown, ttl?: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
}

export interface LongTermView {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  search(query: string): Promise<Array<{ key: string; value: unknown }>>;
}

export interface SharedView {
  get(namespace: string, key: string): Promise<unknown>;
  set(namespace: string, key: string, value: unknown): Promise<void>;
  getNamespace(namespace: string): Promise<Record<string, unknown>>;
}
