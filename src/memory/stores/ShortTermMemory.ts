import { LRUCache } from 'lru-cache';
import { nanoid } from 'nanoid';
import type { ShortTermMemoryConfig, MemoryEntryType } from '../types.js';

export interface ShortTermEntry {
  id: string;
  key: string;
  value: unknown;
  type: MemoryEntryType;
  agentId: string;
  createdAt: Date;
  expiresAt?: Date;
}

export class ShortTermMemory {
  private cache: LRUCache<string, ShortTermEntry>;
  private defaultTtlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(config: ShortTermMemoryConfig) {
    this.defaultTtlMs = config.defaultTtlMs;
    this.cache = new LRUCache<string, ShortTermEntry>({
      max: config.maxSize,
      ttl: config.defaultTtlMs,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });
  }

  private makeKey(agentId: string, key: string): string {
    return `${agentId}:${key}`;
  }

  get(agentId: string, key: string): unknown {
    const cacheKey = this.makeKey(agentId, key);
    const entry = this.cache.get(cacheKey);
    if (entry) {
      this.hits++;
      return entry.value;
    }
    this.misses++;
    return undefined;
  }

  set(
    agentId: string,
    key: string,
    value: unknown,
    type: MemoryEntryType = 'context',
    ttlMs?: number
  ): void {
    const cacheKey = this.makeKey(agentId, key);
    const now = new Date();
    const ttl = ttlMs ?? this.defaultTtlMs;

    const entry: ShortTermEntry = {
      id: nanoid(),
      key,
      value,
      type,
      agentId,
      createdAt: now,
      expiresAt: ttl > 0 ? new Date(now.getTime() + ttl) : undefined,
    };

    this.cache.set(cacheKey, entry, { ttl });
  }

  has(agentId: string, key: string): boolean {
    return this.cache.has(this.makeKey(agentId, key));
  }

  delete(agentId: string, key: string): boolean {
    return this.cache.delete(this.makeKey(agentId, key));
  }

  clear(agentId?: string): void {
    if (agentId) {
      // Clear only entries for specific agent
      const prefix = `${agentId}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  getAll(agentId: string): ShortTermEntry[] {
    const entries: ShortTermEntry[] = [];
    const prefix = `${agentId}:`;

    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(prefix)) {
        entries.push(entry);
      }
    }

    return entries;
  }

  getSize(): number {
    return this.cache.size;
  }

  getMaxSize(): number {
    return this.cache.max;
  }

  getHitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  getStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.getSize(),
      maxSize: this.getMaxSize(),
      hitRate: this.getHitRate(),
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  // Create a view for a specific agent
  createAgentView(agentId: string): AgentShortTermView {
    return new AgentShortTermView(this, agentId);
  }
}

export class AgentShortTermView {
  constructor(
    private memory: ShortTermMemory,
    private agentId: string
  ) {}

  get(key: string): unknown {
    return this.memory.get(this.agentId, key);
  }

  set(key: string, value: unknown, ttl?: number): void {
    this.memory.set(this.agentId, key, value, 'context', ttl);
  }

  has(key: string): boolean {
    return this.memory.has(this.agentId, key);
  }

  delete(key: string): void {
    this.memory.delete(this.agentId, key);
  }

  clear(): void {
    this.memory.clear(this.agentId);
  }
}
