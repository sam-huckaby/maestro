import { Database } from 'bun:sqlite';
import { nanoid } from 'nanoid';
import type { SharedMemoryConfig } from '../types.js';
import { sharedMigrations, runMigrations } from '../schemas/migrations.js';
import { ensureDirectory } from '../../utils/fs.js';
import { MemoryAccessError } from '../../utils/errors.js';
import path from 'node:path';

export class SharedMemory {
  private db: Database;
  private allowedNamespaces: Set<string>;

  constructor(config: SharedMemoryConfig) {
    const dir = path.dirname(config.databasePath);
    ensureDirectory(dir);

    this.db = new Database(config.databasePath);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');
    this.db.run('PRAGMA foreign_keys = ON');

    this.allowedNamespaces = new Set(config.namespaces);

    runMigrations(this.db, sharedMigrations);
  }

  private validateNamespace(namespace: string): void {
    if (!this.allowedNamespaces.has(namespace)) {
      throw new MemoryAccessError('system', namespace);
    }
  }

  async get(namespace: string, key: string): Promise<unknown> {
    this.validateNamespace(namespace);

    const row = this.db
      .prepare(
        `SELECT value FROM shared_entries
         WHERE namespace = ? AND key = ?`
      )
      .get(namespace, key) as { value: string } | undefined;

    if (!row) return undefined;

    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  async set(
    namespace: string,
    key: string,
    value: unknown,
    createdBy: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.validateNamespace(namespace);

    const now = new Date().toISOString();
    const serializedValue = JSON.stringify(value);
    const serializedMetadata = metadata ? JSON.stringify(metadata) : null;

    this.db
      .prepare(
        `INSERT INTO shared_entries (id, namespace, key, value, created_by, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           metadata = excluded.metadata`
      )
      .run(nanoid(), namespace, key, serializedValue, createdBy, now, now, serializedMetadata);
  }

  async has(namespace: string, key: string): Promise<boolean> {
    this.validateNamespace(namespace);

    const row = this.db
      .prepare(
        `SELECT 1 FROM shared_entries
         WHERE namespace = ? AND key = ?`
      )
      .get(namespace, key);

    return row !== undefined;
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    this.validateNamespace(namespace);

    const result = this.db
      .prepare('DELETE FROM shared_entries WHERE namespace = ? AND key = ?')
      .run(namespace, key);
    return result.changes > 0;
  }

  async getNamespace(namespace: string): Promise<Record<string, unknown>> {
    this.validateNamespace(namespace);

    const rows = this.db
      .prepare(
        `SELECT key, value FROM shared_entries
         WHERE namespace = ?
         ORDER BY updated_at DESC`
      )
      .all(namespace) as Array<{ key: string; value: string }>;

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  async listNamespaces(): Promise<Array<{ name: string; entries: number }>> {
    const rows = this.db
      .prepare(
        `SELECT namespace, COUNT(*) as count
         FROM shared_entries
         GROUP BY namespace`
      )
      .all() as Array<{ namespace: string; count: number }>;

    // Include all allowed namespaces, even if empty
    return Array.from(this.allowedNamespaces).map((ns) => ({
      name: ns,
      entries: rows.find((r) => r.namespace === ns)?.count ?? 0,
    }));
  }

  async clearNamespace(namespace: string): Promise<number> {
    this.validateNamespace(namespace);

    const result = this.db
      .prepare('DELETE FROM shared_entries WHERE namespace = ?')
      .run(namespace);
    return result.changes;
  }

  async getRecentEntries(
    namespace: string,
    limit = 20
  ): Promise<
    Array<{
      key: string;
      value: unknown;
      createdBy: string;
      updatedAt: Date;
    }>
  > {
    this.validateNamespace(namespace);

    const rows = this.db
      .prepare(
        `SELECT key, value, created_by, updated_at
         FROM shared_entries
         WHERE namespace = ?
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(namespace, limit) as Array<{
      key: string;
      value: string;
      created_by: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      key: row.key,
      value: this.parseValue(row.value),
      createdBy: row.created_by,
      updatedAt: new Date(row.updated_at),
    }));
  }

  async getStats(): Promise<{
    namespaces: Array<{ name: string; entries: number }>;
    totalEntries: number;
  }> {
    const namespaces = await this.listNamespaces();
    const totalEntries = namespaces.reduce((sum, ns) => sum + ns.entries, 0);
    return { namespaces, totalEntries };
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

  // Create a view for a specific agent with restricted namespace access
  createAgentView(agentId: string, allowedNamespaces: string[]): AgentSharedView {
    return new AgentSharedView(this, agentId, allowedNamespaces);
  }
}

export class AgentSharedView {
  private allowedNamespaces: Set<string>;

  constructor(
    private memory: SharedMemory,
    private agentId: string,
    allowedNamespaces: string[]
  ) {
    this.allowedNamespaces = new Set(allowedNamespaces);
  }

  private validateAccess(namespace: string): void {
    if (!this.allowedNamespaces.has(namespace)) {
      throw new MemoryAccessError(this.agentId, namespace);
    }
  }

  async get(namespace: string, key: string): Promise<unknown> {
    this.validateAccess(namespace);
    return this.memory.get(namespace, key);
  }

  async set(namespace: string, key: string, value: unknown): Promise<void> {
    this.validateAccess(namespace);
    return this.memory.set(namespace, key, value, this.agentId);
  }

  async getNamespace(namespace: string): Promise<Record<string, unknown>> {
    this.validateAccess(namespace);
    return this.memory.getNamespace(namespace);
  }
}
