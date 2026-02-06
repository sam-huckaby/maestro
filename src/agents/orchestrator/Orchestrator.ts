import { EventEmitter } from 'eventemitter3';
import { Agent, type AgentDependencies } from '../base/Agent.js';
import { AgentRegistry, getAgentRegistry } from '../base/AgentRegistry.js';
import type { AgentConfig, AgentResponse } from '../base/types.js';
import type { Task, TaskContext, TaskResult, ProjectContext } from '../../tasks/types.js';
import { TaskQueue } from '../../tasks/TaskQueue.js';
import { createTask } from '../../tasks/Task.js';
import { TaskPlanner } from './TaskPlanner.js';
import { ConfidenceRouter } from './ConfidenceRouter.js';
import { ExecutionLoop } from './ExecutionLoop.js';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './prompts.js';
import { createArchitect } from '../architect/Architect.js';
import { createImplementer } from '../implementer/Implementer.js';
import { createReviewer } from '../reviewer/Reviewer.js';
import type { LLMProvider } from '../../llm/types.js';

export interface OrchestratorEvents {
  goalReceived: (goal: string) => void;
  planCreated: (tasks: Task[]) => void;
  taskStarted: (task: Task) => void;
  taskCompleted: (task: Task, result: TaskResult) => void;
  taskFailed: (task: Task, error: Error) => void;
  goalCompleted: (results: TaskResult[]) => void;
  goalFailed: (error: Error) => void;
}

export interface OrchestratorConfig {
  confidenceThreshold: number;
  maxTaskRetries: number;
  taskTimeoutMs: number;
  reviewRequired: boolean;
  parallelAssessment: boolean;
}

export class Orchestrator extends Agent {
  private registry: AgentRegistry;
  private taskPlanner: TaskPlanner;
  private router: ConfidenceRouter;
  private queue: TaskQueue;
  private executionLoop: ExecutionLoop | null = null;
  private projectContext: ProjectContext;
  private orchestratorConfig: OrchestratorConfig;
  private events: EventEmitter<OrchestratorEvents>;

  constructor(
    dependencies: AgentDependencies,
    projectContext: ProjectContext,
    config: Partial<OrchestratorConfig> = {}
  ) {
    const agentConfig: AgentConfig = {
      id: 'orchestrator',
      role: 'orchestrator',
      capabilities: ['coordination', 'planning', 'analysis'],
      confidenceThreshold: config.confidenceThreshold ?? 0.6,
      maxRetries: config.maxTaskRetries ?? 3,
    };
    super(agentConfig, dependencies);

    this.projectContext = projectContext;
    this.orchestratorConfig = {
      confidenceThreshold: config.confidenceThreshold ?? 0.6,
      maxTaskRetries: config.maxTaskRetries ?? 3,
      taskTimeoutMs: config.taskTimeoutMs ?? 300000,
      reviewRequired: config.reviewRequired ?? true,
      parallelAssessment: config.parallelAssessment ?? true,
    };

    this.events = new EventEmitter();
    this.registry = getAgentRegistry();
    this.queue = new TaskQueue();

    // Initialize components
    this.taskPlanner = new TaskPlanner({ llmProvider: this.llm });
    this.router = new ConfidenceRouter(this.registry, {
      confidenceThreshold: this.orchestratorConfig.confidenceThreshold,
      parallelAssessment: this.orchestratorConfig.parallelAssessment,
    });

    // Register specialized agents
    this.registerAgents(dependencies);
  }

  get systemPrompt(): string {
    return ORCHESTRATOR_SYSTEM_PROMPT;
  }

  on<K extends keyof OrchestratorEvents>(
    event: K,
    listener: OrchestratorEvents[K]
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.events.on(event, listener as any);
    return this;
  }

  off<K extends keyof OrchestratorEvents>(
    event: K,
    listener: OrchestratorEvents[K]
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.events.off(event, listener as any);
    return this;
  }

  private registerAgents(dependencies: AgentDependencies): void {
    // Don't register self
    this.registry.register(createArchitect(dependencies));
    this.registry.register(createImplementer(dependencies));
    this.registry.register(createReviewer(dependencies));
  }

  async ship(goal: string): Promise<TaskResult[]> {
    this.events.emit('goalReceived', goal);

    try {
      // Create and decompose the plan
      const decomposition = await this.taskPlanner.decompose(goal, this.projectContext);
      this.queue.addMany(decomposition.tasks);
      this.events.emit('planCreated', decomposition.tasks);

      // Create and configure execution loop
      this.executionLoop = new ExecutionLoop(
        this.queue,
        this.router,
        this.projectContext,
        {
          maxRetries: this.orchestratorConfig.maxTaskRetries,
          taskTimeoutMs: this.orchestratorConfig.taskTimeoutMs,
          reviewRequired: this.orchestratorConfig.reviewRequired,
        }
      );

      // Forward events
      this.executionLoop.on('taskStarted', (task) => {
        this.events.emit('taskStarted', task);
      });
      this.executionLoop.on('taskCompleted', (task, result) => {
        this.events.emit('taskCompleted', task, result);
      });
      this.executionLoop.on('taskFailed', (task, error) => {
        this.events.emit('taskFailed', task, error);
      });

      // Run execution loop
      const results = await this.executionLoop.run();
      this.events.emit('goalCompleted', results);

      return results;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.events.emit('goalFailed', err);
      throw err;
    }
  }

  async shipSingleTask(goal: string): Promise<TaskResult> {
    const task = createTask({ goal });
    this.queue.add(task);

    // Create minimal execution loop
    this.executionLoop = new ExecutionLoop(
      this.queue,
      this.router,
      this.projectContext,
      {
        maxRetries: this.orchestratorConfig.maxTaskRetries,
        taskTimeoutMs: this.orchestratorConfig.taskTimeoutMs,
        reviewRequired: this.orchestratorConfig.reviewRequired,
      }
    );

    const results = await this.executionLoop.run();
    return results[0]!;
  }

  stop(): void {
    if (this.executionLoop) {
      this.executionLoop.stop();
    }
  }

  getQueue(): TaskQueue {
    return this.queue;
  }

  getRegistry(): AgentRegistry {
    return this.registry;
  }

  getRouter(): ConfidenceRouter {
    return this.router;
  }

  protected buildExecutionPrompt(_task: Task, _context: TaskContext): string {
    // Orchestrator doesn't execute tasks directly
    return '';
  }

  // Override execute to prevent direct execution
  async execute(_task: Task, _context: TaskContext): Promise<AgentResponse> {
    throw new Error('Orchestrator does not execute tasks directly. Use ship() instead.');
  }
}

export function createOrchestrator(
  llmProvider: LLMProvider,
  projectContext: ProjectContext,
  config?: Partial<OrchestratorConfig>
): Orchestrator {
  return new Orchestrator({ llmProvider }, projectContext, config);
}
