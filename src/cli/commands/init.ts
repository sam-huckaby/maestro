import { Command } from 'commander';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../ui/index.js';

interface InitOptions {
  force?: boolean;
}

const DEFAULT_CONFIG = {
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
    timeout: 60000,
  },
  orchestration: {
    defaultConfidenceThreshold: 0.6,
    maxTaskRetries: 3,
    taskTimeoutMs: 300000,
    parallelAssessment: true,
    reviewRequired: true,
  },
  agents: {
    orchestrator: {
      enabled: true,
      confidenceThreshold: 0.6,
      maxRetries: 3,
    },
    architect: {
      enabled: true,
      confidenceThreshold: 0.6,
      maxRetries: 3,
    },
    implementer: {
      enabled: true,
      confidenceThreshold: 0.6,
      maxRetries: 3,
    },
    reviewer: {
      enabled: true,
      confidenceThreshold: 0.6,
      maxRetries: 3,
    },
    devops: {
      enabled: true,
      confidenceThreshold: 0.6,
      maxRetries: 3,
    },
  },
  memory: {
    shortTerm: {
      maxSize: 1000,
      defaultTtlMs: 3600000,
    },
    longTerm: {
      walMode: true,
    },
    shared: {
      namespaces: ['artifacts', 'decisions', 'context', 'errors'],
    },
  },
  cli: {
    colors: true,
    spinners: true,
    verbosity: 'info',
    outputFormat: 'text',
  },
  logging: {
    level: 'info',
    includeTimestamp: false,
    includeAgentId: true,
  },
};

export const initCommand = new Command('init')
  .description('Initialize a new maestro.config.json in the current directory')
  .option('-f, --force', 'Overwrite existing config file')
  .action(async (options: InitOptions) => {
    const configPath = join(process.cwd(), 'maestro.config.json');

    if (existsSync(configPath) && !options.force) {
      logger.error('maestro.config.json already exists. Use --force to overwrite.');
      process.exit(1);
    }

    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');

    logger.success('Created maestro.config.json');
    logger.blank();
    logger.info('Next steps:');
    logger.info('  1. Set ANTHROPIC_API_KEY environment variable');
    logger.info('  2. Run: maestro ship "Your goal here"');
  });
