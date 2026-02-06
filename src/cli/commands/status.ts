import { Command } from 'commander';
import chalk from 'chalk';
import { Config } from '../../config/Config.js';
import { logger } from '../ui/index.js';
import { formatError } from '../../utils/errors.js';
import { getAgentRegistry } from '../../agents/base/AgentRegistry.js';
import { isMemoryInitialized, getMemoryManager } from '../../memory/MemoryManager.js';

interface StatusOptions {
  json?: boolean;
  verbose?: boolean;
}

export const statusCommand = new Command('status')
  .description('Check the status of the current task or recent executions')
  .option('-j, --json', 'Output status as JSON')
  .option('-v, --verbose', 'Show detailed status information')
  .action(async (options: StatusOptions) => {
    try {
      await Config.load();

      const status = await getStatus(options.verbose);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      printStatus(status, options.verbose);
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    }
  });

interface SystemStatus {
  initialized: boolean;
  orchestrator: {
    status: 'idle' | 'busy' | 'not_running';
    currentTask?: string;
  };
  agents: Array<{
    id: string;
    role: string;
    status: 'idle' | 'busy' | 'error';
    currentTaskId?: string;
  }>;
  memory: {
    initialized: boolean;
    shortTermEntries: number;
    longTermEntries: number;
    sharedNamespaces: number;
  };
  config: {
    llmProvider: string;
    llmModel: string;
    confidenceThreshold: number;
    reviewRequired: boolean;
  };
}

async function getStatus(_verbose = false): Promise<SystemStatus> {
  const config = Config.get();
  const registry = getAgentRegistry();
  const memoryInitialized = isMemoryInitialized();

  // Get agent statuses
  const agents = registry.getAll().map((agent) => ({
    id: agent.id,
    role: agent.role,
    status: agent.getStatus(),
    currentTaskId: agent.getCurrentTaskId(),
  }));

  // Get memory stats if initialized
  let memoryStats = {
    initialized: memoryInitialized,
    shortTermEntries: 0,
    longTermEntries: 0,
    sharedNamespaces: 0,
  };

  if (memoryInitialized) {
    const manager = getMemoryManager();
    const stats = await manager.getStats();
    memoryStats = {
      initialized: true,
      shortTermEntries: stats.shortTerm.size,
      longTermEntries: stats.longTerm.entries,
      sharedNamespaces: stats.shared.namespaces.length,
    };
  }

  return {
    initialized: agents.length > 0,
    orchestrator: {
      status: agents.length === 0 ? 'not_running' : 'idle',
    },
    agents,
    memory: memoryStats,
    config: {
      llmProvider: config.llm.provider,
      llmModel: config.llm.model,
      confidenceThreshold: config.orchestration.defaultConfidenceThreshold,
      reviewRequired: config.orchestration.reviewRequired,
    },
  };
}

function printStatus(status: SystemStatus, verbose = false): void {
  logger.divider();
  console.log(chalk.bold('Maestro Status'));
  logger.divider();

  // System status
  const systemStatus = status.initialized
    ? chalk.green('Initialized')
    : chalk.yellow('Not initialized');
  console.log(`\n${chalk.bold('System:')} ${systemStatus}`);

  // Orchestrator status
  const orchStatus = status.orchestrator.status === 'idle'
    ? chalk.green('idle')
    : status.orchestrator.status === 'busy'
    ? chalk.yellow('busy')
    : chalk.gray('not running');

  console.log(`${chalk.bold('Orchestrator:')} ${orchStatus}`);
  if (status.orchestrator.currentTask) {
    console.log(`  Current task: ${status.orchestrator.currentTask}`);
  }

  // Agents status
  console.log(`\n${chalk.bold('Agents:')} ${status.agents.length > 0 ? '' : chalk.gray('None registered')}`);
  for (const agent of status.agents) {
    const agentStatus = agent.status === 'idle'
      ? chalk.green('●')
      : agent.status === 'busy'
      ? chalk.yellow('●')
      : chalk.red('●');
    const taskInfo = agent.currentTaskId ? chalk.gray(` (${agent.currentTaskId})`) : '';
    console.log(`  ${agentStatus} ${agent.id} [${agent.role}]${taskInfo}`);
  }

  // Memory status
  console.log(`\n${chalk.bold('Memory:')}`);
  if (status.memory.initialized) {
    console.log(`  Short-term entries: ${status.memory.shortTermEntries}`);
    console.log(`  Long-term entries: ${status.memory.longTermEntries}`);
    console.log(`  Shared namespaces: ${status.memory.sharedNamespaces}`);
  } else {
    console.log(`  ${chalk.gray('Not initialized')}`);
  }

  // Configuration
  if (verbose) {
    console.log(`\n${chalk.bold('Configuration:')}`);
    console.log(`  LLM Provider: ${status.config.llmProvider}`);
    console.log(`  Model: ${status.config.llmModel}`);
    console.log(`  Confidence threshold: ${status.config.confidenceThreshold}`);
    console.log(`  Review required: ${status.config.reviewRequired ? 'Yes' : 'No'}`);
  }

  logger.blank();
}
