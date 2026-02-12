import { Database } from 'bun:sqlite';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const longTermMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_memory_entries',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_entries (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT,
          metadata TEXT,
          UNIQUE(agent_id, key)
        );

        CREATE INDEX IF NOT EXISTS idx_memory_agent_id ON memory_entries(agent_id);
        CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(key);
        CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
        CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory_entries(created_at);
      `);
    },
  },
  {
    version: 2,
    name: 'create_schema_version',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);
    },
  },
];

export const sharedMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_shared_entries',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS shared_entries (
          id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata TEXT,
          UNIQUE(namespace, key)
        );

        CREATE INDEX IF NOT EXISTS idx_shared_namespace ON shared_entries(namespace);
        CREATE INDEX IF NOT EXISTS idx_shared_key ON shared_entries(key);
        CREATE INDEX IF NOT EXISTS idx_shared_created_by ON shared_entries(created_by);
      `);
    },
  },
  {
    version: 2,
    name: 'create_schema_version',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);
    },
  },
];

export function runMigrations(db: Database, migrations: Migration[]): void {
  // Ensure schema_version table exists first
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // Get current version
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  // Run pending migrations
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          new Date().toISOString()
        );
      })();
    }
  }
}
