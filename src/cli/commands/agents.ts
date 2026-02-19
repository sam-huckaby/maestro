import { Command } from 'commander';
import chalk from 'chalk';
import { Config } from '../../config/Config.js';
import { logger } from '../ui/index.js';
import { formatError } from '../../utils/errors.js';
import type { AgentRole, AgentCapability } from '../../agents/base/types.js';

interface AgentsListOptions {
  json?: boolean;
}

interface AgentInfo {
  name: string;
  role: AgentRole;
  enabled: boolean;
  capabilities: AgentCapability[];
  confidenceThreshold: number;
  description: string;
}

const AGENT_DESCRIPTIONS: Record<AgentRole, { capabilities: AgentCapability[]; description: string }> = {
  orchestrator: {
    capabilities: ['coordination', 'planning', 'analysis'],
    description: 'Coordinates task execution and manages agent workflow',
  },
  architect: {
    capabilities: ['design', 'planning', 'analysis'],
    description: 'Designs system architecture and solution structure',
  },
  implementer: {
    capabilities: ['coding', 'refactoring', 'debugging'],
    description: 'Generates code and implements solutions',
  },
  reviewer: {
    capabilities: ['review', 'testing', 'analysis'],
    description: 'Validates quality, security, and correctness',
  },
  devops: {
    capabilities: ['testing', 'analysis'],
    description: 'Executes build, test, and DevOps commands',
  },
};

export const agentsCommand = new Command('agents')
  .description('List and manage available agents');

agentsCommand
  .command('list')
  .description('List all available agents and their status')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: AgentsListOptions) => {
    try {
      await Config.load();
      const config = Config.get();

      const agents: AgentInfo[] = Object.entries(config.agents).map(([role, agentConfig]) => {
        const roleKey = role as AgentRole;
        const desc = AGENT_DESCRIPTIONS[roleKey];
        return {
          name: role,
          role: roleKey,
          enabled: agentConfig.enabled,
          capabilities: desc.capabilities,
          confidenceThreshold: agentConfig.confidenceThreshold ?? config.orchestration.defaultConfidenceThreshold,
          description: desc.description,
        };
      });

      if (options.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }

      printAgentsList(agents);
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    }
  });

agentsCommand
  .command('info <agent>')
  .description('Show detailed information about an agent')
  .action(async (agentName: string) => {
    try {
      await Config.load();
      const config = Config.get();

      const agentConfig = config.agents[agentName as AgentRole];
      if (!agentConfig) {
        logger.error(`Unknown agent: ${agentName}`);
        logger.info(`Available agents: ${Object.keys(config.agents).join(', ')}`);
        process.exit(1);
      }

      const desc = AGENT_DESCRIPTIONS[agentName as AgentRole];
      printAgentInfo(agentName, agentConfig, desc, config.orchestration.defaultConfidenceThreshold);
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    }
  });

function printAgentsList(agents: AgentInfo[]): void {
  logger.divider();
  console.log(chalk.bold('Available Agents'));
  logger.divider();
  console.log();

  for (const agent of agents) {
    const status = agent.enabled ? chalk.green('●') : chalk.gray('○');
    const name = agent.enabled ? chalk.cyan(agent.name) : chalk.gray(agent.name);

    console.log(`${status} ${name}`);
    console.log(`  ${chalk.gray(agent.description)}`);
    console.log(`  ${chalk.gray('Capabilities:')} ${agent.capabilities.join(', ')}`);
    console.log(`  ${chalk.gray('Confidence threshold:')} ${agent.confidenceThreshold}`);
    console.log();
  }
}

function printAgentInfo(
  name: string,
  config: { enabled: boolean; confidenceThreshold?: number; maxRetries?: number; customPrompt?: string },
  desc: { capabilities: AgentCapability[]; description: string },
  defaultThreshold: number
): void {
  logger.divider();
  console.log(chalk.bold(`Agent: ${name}`));
  logger.divider();
  console.log();

  console.log(`${chalk.bold('Status:')} ${config.enabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);
  console.log(`${chalk.bold('Description:')} ${desc.description}`);
  console.log();

  console.log(chalk.bold('Capabilities:'));
  for (const cap of desc.capabilities) {
    console.log(`  • ${cap}`);
  }
  console.log();

  console.log(chalk.bold('Configuration:'));
  console.log(`  Confidence threshold: ${config.confidenceThreshold ?? defaultThreshold}`);
  console.log(`  Max retries: ${config.maxRetries ?? 3}`);
  if (config.customPrompt) {
    console.log(`  Custom prompt: ${chalk.gray('(configured)')}`);
  }
  console.log();
}
