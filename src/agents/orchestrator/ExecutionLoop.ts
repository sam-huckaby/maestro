import { EventEmitter } from 'eventemitter3';
import type { Agent } from '../base/Agent.js';
import type { AgentResponse, AgentRole } from '../base/types.js';
import type { Task, TaskContext, TaskResult, ProjectContext } from '../../tasks/types.js';
import { TaskQueue } from '../../tasks/TaskQueue.js';
import {
  updateTaskStatus,
  addTaskAttempt,
  completeTaskAttempt,
  updateTaskHandoff,
} from '../../tasks/Task.js';
import { updateHandoffWithResponse } from '../../tasks/HandoffPayload.js';
import { ConfidenceRouter, type RoutingDecision } from './ConfidenceRouter.js';
import { TaskTimeoutError, NoConfidentAgentError } from '../../utils/errors.js';

export interface ExecutionLoopEvents {
  taskStarted: (task: Task, agent: Agent) => void;
  taskCompleted: (task: Task, result: TaskResult) => void;
  taskFailed: (task: Task, error: Error) => void;
  taskRetrying: (task: Task, attempt: number, maxAttempts: number) => void;
  taskRouted: (task: Task, decision: RoutingDecision) => void;
  loopStarted: () => void;
  loopCompleted: (results: TaskResult[]) => void;
  loopError: (error: Error) => void;
}

export interface ExecutionLoopConfig {
  maxRetries: number;
  taskTimeoutMs: number;
  reviewRequired: boolean;
}

export class ExecutionLoop extends EventEmitter<ExecutionLoopEvents> {
  private queue: TaskQueue;
  private router: ConfidenceRouter;
  private config: ExecutionLoopConfig;
  private projectContext: ProjectContext;
  private results: TaskResult[] = [];
  private running = false;

  constructor(
    queue: TaskQueue,
    router: ConfidenceRouter,
    projectContext: ProjectContext,
    config: Partial<ExecutionLoopConfig> = {}
  ) {
    super();
    this.queue = queue;
    this.router = router;
    this.projectContext = projectContext;
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      taskTimeoutMs: config.taskTimeoutMs ?? 300000,
      reviewRequired: config.reviewRequired ?? true,
    };
  }

  async run(): Promise<TaskResult[]> {
    if (this.running) {
      throw new Error('Execution loop is already running');
    }

    this.running = true;
    this.results = [];
    this.emit('loopStarted');

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

        if (error instanceof NoConfidentAgentError) {
          // No agent can handle this task
          currentTask = completeTaskAttempt(currentTask, false, undefined, err.message);
          currentTask = updateTaskStatus(currentTask, 'failed');
          this.queue.update(currentTask);
          this.emit('taskFailed', currentTask, err);
          return;
        }

        // Mark attempt as failed
        currentTask = completeTaskAttempt(currentTask, false, undefined, err.message);
        this.queue.update(currentTask);

        if (attempt < this.config.maxRetries) {
          this.emit('taskRetrying', currentTask, attempt, this.config.maxRetries);
          await this.delay(1000 * attempt); // Exponential backoff
        } else {
          currentTask = updateTaskStatus(currentTask, 'failed');
          this.queue.update(currentTask);
          this.emit('taskFailed', currentTask, err);
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
    return Promise.race([
      agent.execute(task, context),
      this.timeout(task.id, this.config.taskTimeoutMs),
    ]);
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

    return {
      parentTask: undefined,
      relatedTasks,
      projectContext: this.projectContext,
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
}
