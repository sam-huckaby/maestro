import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { LongTermMemoryConfig, MemoryEntry, MemoryEntryType } from '../types.js';
import { longTermMigrations, runMigrations } from '../schemas/migrations.js';
import { ensureDirectory } from '../../utils/fs.js';
import path from 'node:path';

export class LongTermMemory {
  private db: Database.Database;

  constructor(config: LongTermMemoryConfig) {
    // Ensure directory exists
    const dir = path.dirname(config.databasePath);
    // Note: This is sync but happens only once at initialization
    ensureDirectory(dir);

    this.db = new Database(config.databasePath);

    if (config.walMode) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    runMigrations(this.db, longTermMigrations);
  }

  async get(agentId: string, key: string): Promise<unknown> {
    const row = this.db
      .prepare(
        `SELECT value, expires_at FROM memory_entries
         WHERE agent_id = ? AND key = ?`
      )
      .get(agentId, key) as { value: string; expires_at: string | null } | undefined;

    if (!row) return undefined;

    // Check expiration
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await this.delete(agentId, key);
      return undefined;
    }

    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  async set(
    agentId: string,
    key: string,
    value: unknown,
    type: MemoryEntryType = 'context',
    expiresAt?: Date,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = new Date().toISOString();
    const serializedValue = JSON.stringify(value);
    const serializedMetadata = metadata ? JSON.stringify(metadata) : null;

    this.db
      .prepare(
        `INSERT INTO memory_entries (id, agent_id, key, value, type, created_at, updated_at, expires_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, key) DO UPDATE SET
           value = excluded.value,
           type = excluded.type,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at,
           metadata = excluded.metadata`
      )
      .run(
        nanoid(),
        agentId,
        key,
        serializedValue,
        type,
        now,
        now,
        expiresAt?.toISOString() ?? null,
        serializedMetadata
      );
  }

  async has(agentId: string, key: string): Promise<boolean> {
    const row = this.db
      .prepare(
        `SELECT expires_at FROM memory_entries
         WHERE agent_id = ? AND key = ?`
      )
      .get(agentId, key) as { expires_at: string | null } | undefined;

    if (!row) return false;

    // Check expiration
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await this.delete(agentId, key);
      return false;
    }

    return true;
  }

  async delete(agentId: string, key: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM memory_entries WHERE agent_id = ? AND key = ?')
      .run(agentId, key);
    return result.changes > 0;
  }

  async search(
    agentId: string,
    query: string,
    limit = 20
  ): Promise<Array<{ key: string; value: unknown; type: MemoryEntryType }>> {
    const rows = this.db
      .prepare(
        `SELECT key, value, type FROM memory_entries
         WHERE agent_id = ? AND (key LIKE ? OR value LIKE ?)
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(agentId, `%${query}%`, `%${query}%`, limit) as Array<{
      key: string;
      value: string;
      type: MemoryEntryType;
    }>;

    return rows.map((row) => ({
      key: row.key,
      value: this.parseValue(row.value),
      type: row.type,
    }));
  }

  async getAll(agentId: string): Promise<MemoryEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT id, key, value, type, created_at, updated_at, expires_at, metadata
         FROM memory_entries WHERE agent_id = ?
         ORDER BY updated_at DESC`
      )
      .all(agentId) as Array<{
      id: string;
      key: string;
      value: string;
      type: MemoryEntryType;
      created_at: string;
      updated_at: string;
      expires_at: string | null;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      value: this.parseValue(row.value),
      type: row.type,
      agentId,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  async clear(agentId?: string): Promise<number> {
    if (agentId) {
      const result = this.db
        .prepare('DELETE FROM memory_entries WHERE agent_id = ?')
        .run(agentId);
      return result.changes;
    }
    const result = this.db.prepare('DELETE FROM memory_entries').run();
    return result.changes;
  }

  async getStats(): Promise<{ entries: number; sizeBytes: number }> {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as count FROM memory_entries')
      .get() as { count: number };

    // Approximate size by summing value lengths
    const sizeRow = this.db
      .prepare('SELECT SUM(LENGTH(value)) as size FROM memory_entries')
      .get() as { size: number | null };

    return {
      entries: countRow.count,
      sizeBytes: sizeRow.size ?? 0,
    };
  }

  private parseValue(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  close(): void {
    this.db.close();
  }

  // Create a view for a specific agent
  createAgentView(agentId: string): AgentLongTermView {
    return new AgentLongTermView(this, agentId);
  }
}

export class AgentLongTermView {
  constructor(
    private memory: LongTermMemory,
    private agentId: string
  ) {}

  get(key: string): Promise<unknown> {
    return this.memory.get(this.agentId, key);
  }

  set(key: string, value: unknown): Promise<void> {
    return this.memory.set(this.agentId, key, value);
  }

  has(key: string): Promise<boolean> {
    return this.memory.has(this.agentId, key);
  }

  delete(key: string): Promise<boolean> {
    return this.memory.delete(this.agentId, key);
  }

  search(query: string): Promise<Array<{ key: string; value: unknown }>> {
    return this.memory.search(this.agentId, query);
  }
}
