import { EventEmitter } from 'eventemitter3';
import type { Agent } from '../base/Agent.js';
import type { AgentResponse, AgentRole, ActivityEvent } from '../base/types.js';
import type { Task, TaskContext, TaskResult, ProjectContext, FailureReason } from '../../tasks/types.js';
import type { TaskPlanner } from './TaskPlanner.js';
import { TaskQueue } from '../../tasks/TaskQueue.js';
import {
  updateTaskStatus,
  addTaskAttempt,
  completeTaskAttempt,
  updateTaskHandoff,
} from '../../tasks/Task.js';
import { updateHandoffWithResponse } from '../../tasks/HandoffPayload.js';
import { ConfidenceRouter, type RoutingDecision } from './ConfidenceRouter.js';
import {
  TaskTimeoutError,
  NoConfidentAgentError,
  AgentStuckError,
  HandoffCycleLimitError,
} from '../../utils/errors.js';
import { FileContext } from '../../context/FileContext.js';
import {
  ActivityWatchdog,
  type WatchdogConfig,
  getDefaultWatchdogConfig,
} from './ActivityWatchdog.js';
import {
  DEFAULT_RECOVERY_ENABLED,
  DEFAULT_MAX_REPLAN_ATTEMPTS,
  DEFAULT_CASCADE_ON_REPLAN_FAILURE,
} from '../../config/defaults.js';

export interface ExecutionLoopEvents {
  taskStarted: (task: Task, agent: Agent) => void;
  taskCompleted: (task: Task, result: TaskResult) => void;
  taskFailed: (task: Task, error: Error) => void;
  taskRetrying: (task: Task, attempt: number, maxAttempts: number) => void;
  taskRouted: (task: Task, decision: RoutingDecision) => void;
  loopStarted: () => void;
  loopCompleted: (results: TaskResult[]) => void;
  loopError: (error: Error) => void;
  agentStuck: (task: Task, agent: Agent, lastActivityMs: number) => void;
  handoffCycleWarning: (task: Task, cycleCount: number, maxCycles: number) => void;
  taskReplanStarted: (task: Task) => void;
  taskReplanned: (oldTask: Task, newTasks: Task[]) => void;
  taskReplanFailed: (task: Task, error: Error) => void;
  taskCascadeFailed: (task: Task, failedDep: Task) => void;
}

export interface RecoveryConfig {
  enabled: boolean;
  maxReplanAttempts: number;
  cascadeOnReplanFailure: boolean;
}

export interface ExecutionLoopConfig {
  maxRetries: number;
  taskTimeoutMs: number;
  reviewRequired: boolean;
  stuckDetection: WatchdogConfig;
  recovery: RecoveryConfig;
}

export class ExecutionLoop extends EventEmitter<ExecutionLoopEvents> {
  private queue: TaskQueue;
  private router: ConfidenceRouter;
  private config: ExecutionLoopConfig;
  private projectContext: ProjectContext;
  private results: TaskResult[] = [];
  private running = false;
  private watchdog: ActivityWatchdog;
  private stuckAgentAbortControllers: Map<string, AbortController> = new Map();
  private currentAgentByTask: Map<string, Agent> = new Map();
  private taskPlanner?: TaskPlanner;
  private replanAttempts: Map<string, number> = new Map();

  constructor(
    queue: TaskQueue,
    router: ConfidenceRouter,
    projectContext: ProjectContext,
    config: Partial<ExecutionLoopConfig> = {},
    taskPlanner?: TaskPlanner
  ) {
    super();
    this.queue = queue;
    this.router = router;
    this.projectContext = projectContext;
    this.taskPlanner = taskPlanner;
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      taskTimeoutMs: config.taskTimeoutMs ?? 300000,
      reviewRequired: config.reviewRequired ?? true,
      stuckDetection: config.stuckDetection ?? getDefaultWatchdogConfig(),
      recovery: config.recovery ?? {
        enabled: DEFAULT_RECOVERY_ENABLED,
        maxReplanAttempts: DEFAULT_MAX_REPLAN_ATTEMPTS,
        cascadeOnReplanFailure: DEFAULT_CASCADE_ON_REPLAN_FAILURE,
      },
    };

    // Initialize watchdog
    this.watchdog = new ActivityWatchdog(this.config.stuckDetection);
    this.setupWatchdogEvents();
  }

  private setupWatchdogEvents(): void {
    this.watchdog.on('agentStuck', (_agentId, taskId, lastActivityMs) => {
      const task = this.queue.get(taskId);
      const agent = this.currentAgentByTask.get(taskId);
      if (task && agent) {
        this.emit('agentStuck', task, agent, lastActivityMs);
      }
    });

    this.watchdog.on('handoffCycleWarning', (taskId, cycleCount, maxCycles) => {
      const task = this.queue.get(taskId);
      if (task) {
        this.emit('handoffCycleWarning', task, cycleCount, maxCycles);
      }
    });
  }

  async run(): Promise<TaskResult[]> {
    if (this.running) {
      throw new Error('Execution loop is already running');
    }

    this.running = true;
    this.results = [];
    this.emit('loopStarted');

    // Start the watchdog
    this.watchdog.start();

    try {
      while (!this.queue.isComplete() && this.running) {
        const task = this.queue.getNext();

        if (!task) {
          // No tasks ready - check if we're blocked
          const blocked = this.queue.getBlocked();
          if (blocked.length > 0 && this.queue.getInProgress().length === 0) {
            throw new Error(`Deadlock detected: ${blocked.length} blocked tasks with no tasks in progress`);
          }
          // Wait a bit for in-progress tasks
          await this.delay(100);
          continue;
        }

        await this.executeTask(task);
      }

      this.emit('loopCompleted', this.results);
      return this.results;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('loopError', err);
      throw err;
    } finally {
      this.running = false;
      this.watchdog.stop();
      this.stuckAgentAbortControllers.clear();
      this.currentAgentByTask.clear();
    }
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async executeTask(task: Task): Promise<void> {
    let currentTask = updateTaskStatus(task, 'assigned');
    this.queue.update(currentTask);

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Route to best agent
        const decision = await this.router.route(currentTask, this.buildContext(currentTask));
        this.emit('taskRouted', currentTask, decision);

        currentTask = {
          ...currentTask,
          assignedTo: decision.selectedAgent.role,
        };

        // Start execution
        currentTask = updateTaskStatus(currentTask, 'in_progress');
        currentTask = addTaskAttempt(currentTask, {
          agentId: decision.selectedAgent.id,
          agentRole: decision.selectedAgent.role,
          success: false,
          artifacts: [],
        });
        this.queue.update(currentTask);
        this.emit('taskStarted', currentTask, decision.selectedAgent);

        // Execute with timeout
        const response = await this.executeWithTimeout(
          decision.selectedAgent,
          currentTask,
          this.buildContext(currentTask)
        );

        // Handle response
        currentTask = await this.handleResponse(currentTask, response, decision.selectedAgent);

        if (currentTask.status === 'completed') {
          const result = this.buildResult(currentTask, response, decision.selectedAgent.role);
          this.results.push(result);
          this.emit('taskCompleted', currentTask, result);
          return;
        }

        // If task needs more work (e.g., review requested changes), continue loop
        if (currentTask.status === 'pending') {
          // Task was rerouted, restart attempt counter
          attempt = 0;
          continue;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const reason = this.determineFailureReason(err);

        // Clear watchdog state for handoff limit errors
        if (error instanceof HandoffCycleLimitError) {
          this.watchdog.clearTask(currentTask.id);
        }

        // Non-retriable errors: fail immediately and attempt recovery
        if (error instanceof NoConfidentAgentError || error instanceof HandoffCycleLimitError) {
          currentTask = completeTaskAttempt(currentTask, false, undefined, err.message);
          await this.handleTaskFailure(currentTask, err, reason);
          return;
        }

        // Mark attempt as failed
        currentTask = completeTaskAttempt(currentTask, false, undefined, err.message);
        this.queue.update(currentTask);

        if (attempt < this.config.maxRetries) {
          this.emit('taskRetrying', currentTask, attempt, this.config.maxRetries);
          await this.delay(1000 * attempt); // Exponential backoff
        } else {
          // Max retries exceeded - fail and attempt recovery
          await this.handleTaskFailure(currentTask, err, reason);
          return;
        }
      }
    }
  }

  private async executeWithTimeout(
    agent: Agent,
    task: Task,
    context: TaskContext
  ): Promise<AgentResponse> {
    // Track which agent is working on this task
    this.currentAgentByTask.set(task.id, agent);

    // Wire agent's activity callback to watchdog
    agent.setActivityCallback((event: ActivityEvent) => {
      this.watchdog.recordActivity(event);
    });

    // Create AbortController for stuck detection
    const abortController = this.watchdog.createAbortController(agent.id, task.id);
    this.stuckAgentAbortControllers.set(`${agent.id}:${task.id}`, abortController);

    try {
      return await Promise.race([
        agent.execute(task, context),
        this.timeout(task.id, this.config.taskTimeoutMs),
        this.abortPromise(agent.id, agent.role, task.id, abortController),
      ]);
    } finally {
      // Clean up
      agent.clearActivityCallback();
      this.watchdog.clearAgent(agent.id, task.id);
      this.stuckAgentAbortControllers.delete(`${agent.id}:${task.id}`);
      this.currentAgentByTask.delete(task.id);
    }
  }

  private abortPromise(
    agentId: string,
    agentRole: string,
    _taskId: string,
    controller: AbortController
  ): Promise<never> {
    return new Promise((_, reject) => {
      if (controller.signal.aborted) {
        reject(new AgentStuckError(agentId, agentRole, 0, this.config.stuckDetection.activityTimeoutMs));
        return;
      }
      controller.signal.addEventListener('abort', () => {
        reject(new AgentStuckError(agentId, agentRole, 0, this.config.stuckDetection.activityTimeoutMs));
      });
    });
  }

  private timeout(taskId: string, ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TaskTimeoutError(taskId, ms));
      }, ms);
    });
  }

  private async handleResponse(
    task: Task,
    response: AgentResponse,
    agent: Agent
  ): Promise<Task> {
    let updatedTask = completeTaskAttempt(
      task,
      response.success,
      response.output,
      response.success ? undefined : 'Execution failed'
    );

    // Update handoff with response
    updatedTask = updateTaskHandoff(
      updatedTask,
      updateHandoffWithResponse(updatedTask.handoff, response)
    );

    // Handle next action
    if (response.nextAction) {
      switch (response.nextAction.type) {
        case 'complete':
          updatedTask = updateTaskStatus(updatedTask, 'completed');
          break;

        case 'handoff':
          // Record handoff for cycle detection
          if (response.nextAction.targetAgent) {
            this.watchdog.recordHandoff(task.id, agent.role, response.nextAction.targetAgent);

            // Check if handoff limit exceeded
            if (this.watchdog.isHandoffLimitExceeded(task.id)) {
              const history = this.watchdog.getHandoffHistory(task.id);
              const cycleCount = this.watchdog.getHandoffCycleCount(task.id);
              throw new HandoffCycleLimitError(
                task.id,
                cycleCount,
                this.config.stuckDetection.maxHandoffCycles,
                history
              );
            }
          }

          // Reroute to specified agent
          updatedTask = updateTaskStatus(updatedTask, 'pending');
          if (response.nextAction.targetAgent) {
            updatedTask.assignedTo = response.nextAction.targetAgent;
          }
          break;

        case 'retry':
          updatedTask = updateTaskStatus(updatedTask, 'pending');
          break;

        case 'escalate':
          // Mark for orchestrator attention
          updatedTask.metadata.escalated = true;
          updatedTask.metadata.escalationReason = response.nextAction.reason;
          updatedTask = updateTaskStatus(updatedTask, 'failed');
          break;

        default:
          // Default to pending for review if needed
          if (this.config.reviewRequired && agent.role !== 'reviewer') {
            updatedTask = updateTaskStatus(updatedTask, 'reviewing');
          } else {
            updatedTask = updateTaskStatus(updatedTask, 'completed');
          }
      }
    } else {
      // No explicit next action
      if (response.success) {
        if (this.config.reviewRequired && agent.role !== 'reviewer') {
          updatedTask = updateTaskStatus(updatedTask, 'reviewing');
        } else {
          updatedTask = updateTaskStatus(updatedTask, 'completed');
        }
      } else {
        updatedTask = updateTaskStatus(updatedTask, 'failed');
      }
    }

    this.queue.update(updatedTask);
    return updatedTask;
  }

  private buildContext(task: Task): TaskContext {
    const relatedTasks = this.queue
      .getDependencies(task.id)
      .concat(this.queue.getDependents(task.id));

    // Create FileContext for project file awareness
    const fileContext = new FileContext({
      workingDirectory: this.projectContext.workingDirectory,
    });

    return {
      parentTask: undefined,
      relatedTasks,
      projectContext: this.projectContext,
      fileContext,
      executionHistory: task.attempts,
    };
  }

  private buildResult(task: Task, response: AgentResponse, agentRole: AgentRole): TaskResult {
    const lastAttempt = task.attempts[task.attempts.length - 1];
    const duration = lastAttempt?.completedAt && lastAttempt?.startedAt
      ? lastAttempt.completedAt.getTime() - lastAttempt.startedAt.getTime()
      : 0;

    return {
      taskId: task.id,
      success: response.success,
      output: response.output,
      artifacts: response.artifacts,
      duration,
      agentRole,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async attemptRecovery(
    failedTask: Task,
    error: Error,
    reason: FailureReason
  ): Promise<boolean> {
    if (!this.config.recovery.enabled || !this.taskPlanner) {
      return false;
    }

    const attempts = this.replanAttempts.get(failedTask.id) ?? 0;
    if (attempts >= this.config.recovery.maxReplanAttempts) {
      return false;
    }

    this.replanAttempts.set(failedTask.id, attempts + 1);
    this.emit('taskReplanStarted', failedTask);

    try {
      // Build feedback for the architect
      const feedback = this.buildReplanFeedback(failedTask, error, reason);

      // Ask TaskPlanner to refine the failed task
      const refinedTasks = await this.taskPlanner.refineTask(
        failedTask,
        feedback,
        this.projectContext
      );

      if (refinedTasks.length === 0) {
        throw new Error('Replanning produced no tasks');
      }

      // Replace failed task with refined tasks
      this.queue.replaceWithRefinedTasks(failedTask.id, refinedTasks, true);
      this.emit('taskReplanned', failedTask, refinedTasks);

      return true;
    } catch (replanError) {
      this.emit('taskReplanFailed', failedTask, replanError as Error);
      return false;
    }
  }

  private buildReplanFeedback(task: Task, error: Error, reason: FailureReason): string {
    const lastAttempt = task.attempts[task.attempts.length - 1];

    let feedback = `Task failed with error: ${error.message}\n`;
    feedback += `Failure reason: ${reason}\n`;
    feedback += `Attempts made: ${task.attempts.length}\n`;

    if (reason === 'handoff_limit') {
      feedback += '\nThe task caused too many handoffs between agents. ';
      feedback += 'Please break it into smaller, more focused tasks that can be completed by a single agent.\n';
    } else if (reason === 'no_confident_agent') {
      feedback += '\nNo agent was confident enough to handle this task. ';
      feedback += 'Please simplify the task or break it into parts that match agent capabilities.\n';
    } else if (reason === 'timeout' || reason === 'agent_stuck') {
      feedback += '\nThe task took too long or the agent got stuck. ';
      feedback += 'Please break it into smaller, quicker tasks.\n';
    }

    if (lastAttempt?.output) {
      feedback += `\nLast output before failure:\n${lastAttempt.output.slice(0, 500)}\n`;
    }

    return feedback;
  }

  private async handleTaskFailure(
    task: Task,
    error: Error,
    reason: FailureReason
  ): Promise<void> {
    // Mark task as failed with failure info
    const failedTask: Task = {
      ...task,
      status: 'failed',
      failureInfo: {
        reason,
        message: error.message,
        timestamp: new Date(),
        replanAttempted: false,
      },
    };
    this.queue.update(failedTask);
    this.emit('taskFailed', failedTask, error);

    // Attempt recovery via replanning
    const recovered = await this.attemptRecovery(failedTask, error, reason);

    if (recovered) {
      // Update failure info to show replan was attempted
      const updatedTask = this.queue.get(failedTask.id);
      if (updatedTask && updatedTask.failureInfo) {
        updatedTask.failureInfo.replanAttempted = true;
        this.queue.update(updatedTask);
      }
      return; // Recovery successful, continue with new tasks
    }

    // Recovery failed - cascade failure to dependents
    if (this.config.recovery.cascadeOnReplanFailure) {
      const cascaded = this.queue.cascadeFailure(failedTask);
      for (const t of cascaded) {
        this.emit('taskCascadeFailed', t, failedTask);
      }
    }
  }

  private determineFailureReason(error: Error): FailureReason {
    if (error instanceof NoConfidentAgentError) {
      return 'no_confident_agent';
    }
    if (error instanceof HandoffCycleLimitError) {
      return 'handoff_limit';
    }
    if (error instanceof TaskTimeoutError) {
      return 'timeout';
    }
    if (error instanceof AgentStuckError) {
      return 'agent_stuck';
    }
    return 'execution_error';
  }
}
