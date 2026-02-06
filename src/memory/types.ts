import { z } from 'zod';
import type { AgentRole } from '../agents/base/types.js';

export const MemoryEntryTypeSchema = z.enum([
  'decision',
  'artifact',
  'context',
  'learning',
  'error',
  'handoff',
]);
export type MemoryEntryType = z.infer<typeof MemoryEntryTypeSchema>;

export interface MemoryEntry {
  id: string;
  key: string;
  value: unknown;
  type: MemoryEntryType;
  agentId: string;
  namespace?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ShortTermMemoryConfig {
  maxSize: number;
  defaultTtlMs: number;
}

export interface LongTermMemoryConfig {
  databasePath: string;
  walMode: boolean;
}

export interface SharedMemoryConfig {
  databasePath: string;
  namespaces: string[];
}

export interface MemoryManagerConfig {
  shortTerm: ShortTermMemoryConfig;
  longTerm: LongTermMemoryConfig;
  shared: SharedMemoryConfig;
}

export interface MemoryStats {
  shortTerm: {
    size: number;
    maxSize: number;
    hitRate: number;
  };
  longTerm: {
    entries: number;
    sizeBytes: number;
  };
  shared: {
    namespaces: string[];
    totalEntries: number;
  };
}

export interface AgentMemoryScope {
  agentId: string;
  agentRole: AgentRole;
  allowedNamespaces: string[];
}

export const SharedNamespaces = {
  ARTIFACTS: 'artifacts',
  DECISIONS: 'decisions',
  CONTEXT: 'context',
  ERRORS: 'errors',
} as const;

export type SharedNamespace = (typeof SharedNamespaces)[keyof typeof SharedNamespaces];
