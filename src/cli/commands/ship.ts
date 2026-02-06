import { Command } from 'commander';
import { Config } from '../../config/Config.js';
import { logger, createShipProgress, MultiStepProgress } from '../ui/index.js';
import { formatError } from '../../utils/errors.js';
import { createOrchestrator } from '../../agents/orchestrator/Orchestrator.js';
import { createLLMProvider } from '../../llm/LLMProvider.js';
import { initializeMemory, closeMemory } from '../../memory/MemoryManager.js';
import { resetAgentRegistry } from '../../agents/base/AgentRegistry.js';
import type { ProjectContext, Task, TaskResult } from '../../tasks/types.js';

interface ShipOptions {
  dryRun?: boolean;
  verbose?: boolean;
  agent?: string;
  noReview?: boolean;
  json?: boolean;
}

export const shipCommand = new Command('ship')
  .description('Ship a feature or complete a goal using the agent orchestration system')
  .argument('<goal>', 'The goal or feature to ship')
  .option('-d, --dry-run', 'Show what would be done without executing')
  .option('-v, --verbose', 'Enable verbose output')
  .option('-a, --agent <agent>', 'Force assignment to a specific agent')
  .option('--no-review', 'Skip the review step')
  .option('-j, --json', 'Output results as JSON')
  .action(async (goal: string, options: ShipOptions) => {
    try {
      // Load configuration
      await Config.load();
      const config = Config.get();

      if (options.verbose) {
        logger.setLevel('debug');
      }

      if (!options.json) {
        logger.info(`Starting: ${goal}`);
        logger.blank();
      }

      if (options.dryRun) {
        if (!options.json) {
          logger.warn('Dry run mode - no changes will be made');
          logger.blank();
        }
        await runDryRun(goal, options);
        return;
      }

      // Initialize systems
      initializeMemory(config.memory);

      // Create project context
      const projectContext: ProjectContext = {
        name: 'maestro-project',
        description: goal,
        workingDirectory: process.cwd(),
        constraints: [],
        preferences: {},
      };

      // Create LLM provider
      const llmProvider = createLLMProvider(config.llm);

      // Create orchestrator
      const orchestrator = createOrchestrator(llmProvider, projectContext, {
        confidenceThreshold: config.orchestration.defaultConfidenceThreshold,
        maxTaskRetries: config.orchestration.maxTaskRetries,
        taskTimeoutMs: config.orchestration.taskTimeoutMs,
        reviewRequired: config.orchestration.reviewRequired && !options.noReview,
        parallelAssessment: config.orchestration.parallelAssessment,
      });

      // Set up progress tracking
      const progress = options.json ? null : createShipProgress();
      const results: TaskResult[] = [];
      const errors: Error[] = [];

      // Register event handlers
      orchestrator.on('planCreated', (tasks: Task[]) => {
        if (progress) {
          progress.complete('plan', `${tasks.length} tasks created`);
        }
        if (options.verbose && !options.json) {
          logger.debug(`Tasks: ${tasks.map((t) => t.goal).join(', ')}`);
        }
      });

      orchestrator.on('taskStarted', (task: Task) => {
        if (progress && task.assignedTo) {
          const stepId = mapRoleToStep(task.assignedTo);
          if (stepId) {
            progress.start(stepId, task.goal);
          }
        }
        if (options.verbose && !options.json) {
          logger.agent(task.assignedTo || 'unknown', `Starting: ${task.goal}`);
        }
      });

      orchestrator.on('taskCompleted', (task: Task, result: TaskResult) => {
        results.push(result);
        if (progress && task.assignedTo) {
          const stepId = mapRoleToStep(task.assignedTo);
          if (stepId) {
            progress.complete(stepId, 'Done');
          }
        }
        if (options.verbose && !options.json) {
          logger.success(`Task completed: ${task.goal}`);
        }
      });

      orchestrator.on('taskFailed', (task: Task, error: Error) => {
        errors.push(error);
        if (progress && task.assignedTo) {
          const stepId = mapRoleToStep(task.assignedTo);
          if (stepId) {
            progress.fail(stepId, error.message);
          }
        }
        if (!options.json) {
          logger.error(`Task failed: ${task.goal} - ${error.message}`);
        }
      });

      // Start planning phase
      if (progress) {
        progress.start('plan', 'Analyzing goal and creating plan');
      }

      try {
        // Execute the goal
        const finalResults = await orchestrator.ship(goal);

        // Mark completion
        if (progress) {
          progress.complete('complete', 'Feature shipped successfully');
        }

        // Output results
        if (options.json) {
          console.log(JSON.stringify({
            success: true,
            goal,
            results: finalResults,
            errors: errors.map((e) => e.message),
          }, null, 2));
        } else {
          logger.blank();
          progress?.printSummary();

          if (options.verbose) {
            logger.blank();
            logger.info('Artifacts generated:');
            for (const result of finalResults) {
              for (const artifact of result.artifacts) {
                logger.info(`  - ${artifact.type}: ${artifact.name}`);
              }
            }
          }
        }
      } catch (error) {
        if (progress) {
          const currentStep = getCurrentStep(progress);
          if (currentStep) {
            progress.fail(currentStep, formatError(error));
          }
        }

        if (options.json) {
          console.log(JSON.stringify({
            success: false,
            goal,
            error: formatError(error),
            results,
          }, null, 2));
        } else {
          logger.blank();
          progress?.printSummary();
        }

        throw error;
      } finally {
        // Cleanup
        closeMemory();
        resetAgentRegistry();
      }
    } catch (error) {
      if (!options.json) {
        logger.error(formatError(error));
      }
      process.exit(1);
    }
  });

function mapRoleToStep(role: string): string | null {
  switch (role) {
    case 'architect':
      return 'architect';
    case 'implementer':
      return 'implement';
    case 'reviewer':
      return 'review';
    default:
      return null;
  }
}

function getCurrentStep(progress: MultiStepProgress): string | null {
  const status = progress.getStatus();
  const inProgress = status.find((s) => s.status === 'in_progress');
  return inProgress?.id ?? null;
}

async function runDryRun(goal: string, options: ShipOptions): Promise<void> {
  const steps = [
    { step: 1, action: 'Orchestrator receives goal', detail: goal },
    { step: 2, action: 'TaskPlanner decomposes into tasks', detail: 'Breaking down goal into actionable tasks' },
    { step: 3, action: 'ConfidenceRouter assesses agents', detail: 'All agents evaluate task fitness' },
    { step: 4, action: 'Architect designs solution', detail: 'Creating system design and structure' },
    { step: 5, action: 'Implementer generates code', detail: 'Writing implementation code' },
    { step: 6, action: options.noReview ? 'Review skipped' : 'Reviewer validates quality', detail: options.noReview ? 'User requested no review' : 'Checking quality and security' },
    { step: 7, action: 'Orchestrator confirms completion', detail: 'Verifying all tasks completed' },
  ];

  if (options.json) {
    console.log(JSON.stringify({
      dryRun: true,
      goal,
      steps,
    }, null, 2));
    return;
  }

  logger.info('Dry run plan:');
  logger.blank();

  for (const { step, action, detail } of steps) {
    logger.info(`  ${step}. ${action}`);
    if (options.verbose) {
      logger.debug(`     ${detail}`);
    }
  }

  logger.blank();
  logger.success('Dry run complete - no changes made');
}
