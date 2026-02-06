import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { shipCommand } from './commands/ship.js';
import { statusCommand } from './commands/status.js';
import { agentsCommand } from './commands/agents.js';
import { memoryCommand } from './commands/memory.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('maestro')
    .description('Multi-Agent Orchestration CLI - Coordinate AI agents using confidence-based routing')
    .version('1.0.0');

  program.addCommand(initCommand);
  program.addCommand(shipCommand);
  program.addCommand(statusCommand);
  program.addCommand(agentsCommand);
  program.addCommand(memoryCommand);

  return program;
}

export async function runCli(args: string[] = process.argv): Promise<void> {
  const program = createCli();
  await program.parseAsync(args);
}
