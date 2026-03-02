import { Command } from 'commander';
import { Config } from '../../config/Config.js';
import { logger } from '../ui/index.js';
import { formatError } from '../../utils/errors.js';
import { createLLMProvider } from '../../llm/LLMProvider.js';
import { FileContext } from '../../context/FileContext.js';
import { profileProject, type ProjectProfile } from '../../context/profileProject.js';

interface AnalyseOptions {
  verbose?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

function formatProfileSummary(profile: ProjectProfile): string {
  const lines = [
    `  Build command: ${profile.buildCommand}`,
    `  Test command: ${profile.testCommand}`,
    `  Install command: ${profile.installCommand}`,
    `  Languages: ${profile.languages.join(', ') || 'unknown'}`,
  ];
  if (profile.packageManager) lines.push(`  Package manager: ${profile.packageManager}`);
  if (profile.bundler) lines.push(`  Bundler: ${profile.bundler}`);
  if (profile.framework) lines.push(`  Framework: ${profile.framework}`);
  if (profile.monorepo) lines.push(`  Monorepo: yes`);
  if (profile.notes) lines.push(`  Notes: ${profile.notes}`);
  return lines.join('\n');
}

export const analyseCommand = new Command('analyse')
  .alias('analyze')
  .description('Analyse the current project and save the profile to maestro.config.json')
  .option('-v, --verbose', 'Enable verbose output (show files being read)')
  .option('-j, --json', 'Output raw JSON')
  .option('--dry-run', 'Show the profile without saving to maestro.config.json')
  .action(async (options: AnalyseOptions) => {
    try {
      await Config.load();
      const config = Config.get();

      if (options.verbose) logger.setLevel('debug');

      const workingDirectory = process.cwd();
      const llmProvider = createLLMProvider(config.llm);
      const fileContext = new FileContext({ workingDirectory });

      if (!options.json) {
        logger.agent('profiler', 'Analysing project...');
      }

      const profile = await profileProject(llmProvider, fileContext, !!options.json);

      if (!options.dryRun) {
        const savedPath = config.saveProjectProfile(profile);
        if (!options.json) {
          logger.success(`Project profile saved to ${savedPath}`);
        }
      } else if (!options.json) {
        logger.info('Dry run — profile not saved to config');
      }

      if (options.json) {
        console.log(JSON.stringify(profile, null, 2));
      } else {
        logger.success('Project profile:');
        console.log(formatProfileSummary(profile));
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: formatError(error) }, null, 2));
      } else {
        logger.error(formatError(error));
      }
      process.exit(1);
    }
  });
