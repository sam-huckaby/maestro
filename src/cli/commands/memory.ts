import { Command } from 'commander';
import chalk from 'chalk';
import { Config } from '../../config/Config.js';
import { logger } from '../ui/index.js';
import { formatError } from '../../utils/errors.js';
import {
  initializeMemory,
  getMemoryManager,
  isMemoryInitialized,
  closeMemory,
} from '../../memory/MemoryManager.js';
import { SharedNamespaces } from '../../memory/types.js';

interface MemoryListOptions {
  agent?: string;
  namespace?: string;
  json?: boolean;
  limit?: string;
}

interface MemoryClearOptions {
  agent?: string;
  namespace?: string;
  force?: boolean;
}

export const memoryCommand = new Command('memory')
  .description('Inspect and manage agent memory');

memoryCommand
  .command('list')
  .description('List memory entries')
  .option('-a, --agent <agent>', 'Filter by agent')
  .option('-n, --namespace <namespace>', 'Filter by namespace')
  .option('-j, --json', 'Output as JSON')
  .option('-l, --limit <count>', 'Limit number of entries', '20')
  .action(async (options: MemoryListOptions) => {
    try {
      await Config.load();
      const config = Config.get();

      ensureMemoryInitialized(config);

      const entries = await getMemoryEntries(options);

      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      printMemoryEntries(entries, options);
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    } finally {
      closeMemory();
    }
  });

memoryCommand
  .command('stats')
  .description('Show memory statistics')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      await Config.load();
      const config = Config.get();

      ensureMemoryInitialized(config);

      const stats = await getMemoryStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      printMemoryStats(stats);
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    } finally {
      closeMemory();
    }
  });

memoryCommand
  .command('clear')
  .description('Clear memory entries')
  .option('-a, --agent <agent>', 'Clear only entries for specific agent')
  .option('-n, --namespace <namespace>', 'Clear only entries in specific namespace')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (options: MemoryClearOptions) => {
    try {
      await Config.load();
      const config = Config.get();

      ensureMemoryInitialized(config);

      const scope = options.agent || options.namespace || 'all';

      if (!options.force) {
        logger.warn(`This will clear ${scope} memory entries.`);
        logger.info('Use --force to skip this confirmation.');
        closeMemory();
        return;
      }

      const manager = getMemoryManager();
      let clearedCount = 0;

      if (options.agent) {
        await manager.clearAgent(options.agent);
        logger.success(`Cleared memory for agent: ${options.agent}`);
      } else if (options.namespace) {
        const shared = manager.getSharedMemory();
        clearedCount = await shared.clearNamespace(options.namespace);
        logger.success(`Cleared ${clearedCount} entries from namespace: ${options.namespace}`);
      } else {
        await manager.clearAll();
        logger.success('All memory cleared');
      }
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    } finally {
      closeMemory();
    }
  });

memoryCommand
  .command('namespaces')
  .description('List available shared memory namespaces')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      await Config.load();
      const config = Config.get();

      ensureMemoryInitialized(config);

      const manager = getMemoryManager();
      const shared = manager.getSharedMemory();
      const namespaces = await shared.listNamespaces();

      if (options.json) {
        console.log(JSON.stringify(namespaces, null, 2));
        return;
      }

      logger.divider();
      console.log(chalk.bold('Shared Memory Namespaces'));
      logger.divider();
      console.log();

      for (const ns of namespaces) {
        console.log(`  ${chalk.cyan(ns.name)}: ${ns.entries} entries`);
      }

      console.log();
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    } finally {
      closeMemory();
    }
  });

function ensureMemoryInitialized(config: ReturnType<typeof Config.get>): void {
  if (!isMemoryInitialized()) {
    initializeMemory(config.memory);
  }
}

interface MemoryEntry {
  key: string;
  type: string;
  agent?: string;
  namespace?: string;
  createdAt: string;
  preview: string;
}

async function getMemoryEntries(options: MemoryListOptions): Promise<MemoryEntry[]> {
  const manager = getMemoryManager();
  const entries: MemoryEntry[] = [];
  const limit = parseInt(options.limit || '20', 10);

  if (options.namespace) {
    // Get from shared memory
    const shared = manager.getSharedMemory();
    const recent = await shared.getRecentEntries(options.namespace, limit);
    for (const entry of recent) {
      entries.push({
        key: entry.key,
        type: 'shared',
        namespace: options.namespace,
        createdAt: entry.updatedAt.toISOString(),
        preview: truncateValue(entry.value),
      });
    }
  } else if (options.agent) {
    // Get from long-term memory for specific agent
    const longTerm = manager.getLongTermMemory();
    const agentEntries = await longTerm.getAll(options.agent);
    for (const entry of agentEntries.slice(0, limit)) {
      entries.push({
        key: entry.key,
        type: entry.type,
        agent: options.agent,
        createdAt: entry.createdAt.toISOString(),
        preview: truncateValue(entry.value),
      });
    }
  } else {
    // Get overview from all namespaces
    const shared = manager.getSharedMemory();
    for (const namespace of Object.values(SharedNamespaces)) {
      const recent = await shared.getRecentEntries(namespace, 5);
      for (const entry of recent) {
        entries.push({
          key: entry.key,
          type: 'shared',
          namespace,
          createdAt: entry.updatedAt.toISOString(),
          preview: truncateValue(entry.value),
        });
      }
    }
  }

  return entries.slice(0, limit);
}

function truncateValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > 100 ? str.slice(0, 97) + '...' : str;
}

interface MemoryStats {
  shortTerm: {
    entries: number;
    maxSize: number;
    hitRate: number;
  };
  longTerm: {
    entries: number;
    sizeBytes: number;
  };
  shared: {
    namespaces: Array<{ name: string; entries: number }>;
    totalEntries: number;
  };
}

async function getMemoryStats(): Promise<MemoryStats> {
  const manager = getMemoryManager();
  const stats = await manager.getStats();

  const shared = manager.getSharedMemory();
  const sharedStats = await shared.getStats();

  return {
    shortTerm: {
      entries: stats.shortTerm.size,
      maxSize: stats.shortTerm.maxSize,
      hitRate: stats.shortTerm.hitRate,
    },
    longTerm: stats.longTerm,
    shared: sharedStats,
  };
}

function printMemoryEntries(entries: MemoryEntry[], options: MemoryListOptions): void {
  const filters: string[] = [];
  if (options.agent) filters.push(`agent=${options.agent}`);
  if (options.namespace) filters.push(`namespace=${options.namespace}`);

  logger.divider();
  console.log(chalk.bold('Memory Entries'));
  if (filters.length > 0) {
    console.log(chalk.gray(`Filters: ${filters.join(', ')}`));
  }
  logger.divider();
  console.log();

  if (entries.length === 0) {
    console.log(chalk.gray('No memory entries found'));
    return;
  }

  for (const entry of entries) {
    console.log(`${chalk.cyan(entry.key)}`);
    console.log(`  Type: ${entry.type}`);
    if (entry.agent) console.log(`  Agent: ${entry.agent}`);
    if (entry.namespace) console.log(`  Namespace: ${entry.namespace}`);
    console.log(`  Created: ${entry.createdAt}`);
    console.log(`  Preview: ${chalk.gray(entry.preview)}`);
    console.log();
  }
}

function printMemoryStats(stats: MemoryStats): void {
  logger.divider();
  console.log(chalk.bold('Memory Statistics'));
  logger.divider();
  console.log();

  console.log(chalk.bold('Short-Term Memory:'));
  console.log(`  Entries: ${stats.shortTerm.entries} / ${stats.shortTerm.maxSize}`);
  console.log(`  Hit rate: ${(stats.shortTerm.hitRate * 100).toFixed(1)}%`);
  console.log();

  console.log(chalk.bold('Long-Term Memory:'));
  console.log(`  Entries: ${stats.longTerm.entries}`);
  console.log(`  Size: ${formatBytes(stats.longTerm.sizeBytes)}`);
  console.log();

  console.log(chalk.bold('Shared Memory:'));
  console.log(`  Total entries: ${stats.shared.totalEntries}`);
  for (const ns of stats.shared.namespaces) {
    console.log(`  ${ns.name}: ${ns.entries} entries`);
  }
  console.log();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
