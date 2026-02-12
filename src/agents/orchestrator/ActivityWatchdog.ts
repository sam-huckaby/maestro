import { EventEmitter } from 'eventemitter3';
import {
  DEFAULT_ACTIVITY_TIMEOUT_MS,
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_MAX_HANDOFF_CYCLES,
  DEFAULT_LLM_GRACE_PERIOD_MS,
} from '../../config/defaults.js';

export type ActivityType =
  | 'llm_request_start'
  | 'llm_response_received'
  | 'tool_execution_start'
  | 'tool_execution_complete';

export interface ActivityEvent {
  type: ActivityType;
  agentId: string;
  taskId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface WatchdogConfig {
  enabled: boolean;
  activityTimeoutMs: number;
  checkIntervalMs: number;
  maxHandoffCycles: number;
  gracePeriodsEnabled: boolean;
  llmRequestGracePeriodMs: number;
}

export interface WatchdogEvents {
  agentStuck: (agentId: string, taskId: string, lastActivityMs: number) => void;
  handoffCycleWarning: (taskId: string, cycleCount: number, maxCycles: number) => void;
  handoffCycleExceeded: (taskId: string, cycleCount: number) => void;
}

interface AgentActivityState {
  agentId: string;
  taskId: string;
  lastActivity: Date;
  lastActivityType: ActivityType;
  inLlmRequest: boolean;
  llmRequestStartTime?: Date;
  abortController?: AbortController;
}

interface HandoffRecord {
  from: string;
  to: string;
  timestamp: Date;
}

interface TaskHandoffState {
  history: HandoffRecord[];
  cycleCount: number;
}

export function getDefaultWatchdogConfig(): WatchdogConfig {
  return {
    enabled: true,
    activityTimeoutMs: DEFAULT_ACTIVITY_TIMEOUT_MS,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
    maxHandoffCycles: DEFAULT_MAX_HANDOFF_CYCLES,
    gracePeriodsEnabled: true,
    llmRequestGracePeriodMs: DEFAULT_LLM_GRACE_PERIOD_MS,
  };
}

export class ActivityWatchdog extends EventEmitter<WatchdogEvents> {
  private config: WatchdogConfig;
  private agentStates: Map<string, AgentActivityState> = new Map();
  private taskHandoffs: Map<string, TaskHandoffState> = new Map();
  private checkInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(config: Partial<WatchdogConfig> = {}) {
    super();
    this.config = { ...getDefaultWatchdogConfig(), ...config };
  }

  start(): void {
    if (!this.config.enabled || this.running) {
      return;
    }

    this.running = true;
    this.checkInterval = setInterval(() => {
      this.checkForStuckAgents();
    }, this.config.checkIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    this.agentStates.clear();
    this.taskHandoffs.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Record activity for an agent
   */
  recordActivity(event: ActivityEvent): void {
    if (!this.config.enabled) {
      return;
    }

    const key = this.getAgentKey(event.agentId, event.taskId);
    const state = this.agentStates.get(key) || {
      agentId: event.agentId,
      taskId: event.taskId,
      lastActivity: event.timestamp,
      lastActivityType: event.type,
      inLlmRequest: false,
    };

    state.lastActivity = event.timestamp;
    state.lastActivityType = event.type;

    // Track LLM request state for grace period
    if (event.type === 'llm_request_start') {
      state.inLlmRequest = true;
      state.llmRequestStartTime = event.timestamp;
    } else if (event.type === 'llm_response_received') {
      state.inLlmRequest = false;
      state.llmRequestStartTime = undefined;
    }

    this.agentStates.set(key, state);
  }

  /**
   * Create an AbortController for an agent that will abort on stuck detection
   */
  createAbortController(agentId: string, taskId: string): AbortController {
    const controller = new AbortController();
    const key = this.getAgentKey(agentId, taskId);

    const state = this.agentStates.get(key);
    if (state) {
      state.abortController = controller;
    } else {
      this.agentStates.set(key, {
        agentId,
        taskId,
        lastActivity: new Date(),
        lastActivityType: 'llm_request_start',
        inLlmRequest: false,
        abortController: controller,
      });
    }

    return controller;
  }

  /**
   * Get the AbortController for an agent
   */
  getAbortController(agentId: string, taskId: string): AbortController | undefined {
    const key = this.getAgentKey(agentId, taskId);
    return this.agentStates.get(key)?.abortController;
  }

  /**
   * Clear tracking for an agent when execution completes
   */
  clearAgent(agentId: string, taskId: string): void {
    const key = this.getAgentKey(agentId, taskId);
    this.agentStates.delete(key);
  }

  /**
   * Record a handoff between agents for a task
   */
  recordHandoff(taskId: string, fromAgent: string, toAgent: string): void {
    if (!this.config.enabled) {
      return;
    }

    const state = this.taskHandoffs.get(taskId) || {
      history: [],
      cycleCount: 0,
    };

    const record: HandoffRecord = {
      from: fromAgent,
      to: toAgent,
      timestamp: new Date(),
    };

    state.history.push(record);

    // Count cycles: A->B->A is one cycle
    const cycleCount = this.countHandoffCycles(state.history);
    state.cycleCount = cycleCount;

    this.taskHandoffs.set(taskId, state);

    // Emit warning at 80% of max
    const warningThreshold = Math.floor(this.config.maxHandoffCycles * 0.8);
    if (cycleCount === warningThreshold && cycleCount > 0) {
      this.emit('handoffCycleWarning', taskId, cycleCount, this.config.maxHandoffCycles);
    }

    // Emit exceeded event
    if (cycleCount >= this.config.maxHandoffCycles) {
      this.emit('handoffCycleExceeded', taskId, cycleCount);
    }
  }

  /**
   * Check if a task has exceeded the handoff limit
   */
  isHandoffLimitExceeded(taskId: string): boolean {
    const state = this.taskHandoffs.get(taskId);
    if (!state) {
      return false;
    }
    return state.cycleCount >= this.config.maxHandoffCycles;
  }

  /**
   * Get the handoff history for a task
   */
  getHandoffHistory(taskId: string): Array<{ from: string; to: string }> {
    const state = this.taskHandoffs.get(taskId);
    if (!state) {
      return [];
    }
    return state.history.map((h) => ({ from: h.from, to: h.to }));
  }

  /**
   * Get the current handoff cycle count for a task
   */
  getHandoffCycleCount(taskId: string): number {
    return this.taskHandoffs.get(taskId)?.cycleCount ?? 0;
  }

  /**
   * Clear handoff tracking for a task
   */
  clearTask(taskId: string): void {
    this.taskHandoffs.delete(taskId);
  }

  private checkForStuckAgents(): void {
    const now = new Date();

    for (const [key, state] of this.agentStates) {
      const timeoutMs = this.getEffectiveTimeout(state);
      const elapsedMs = now.getTime() - state.lastActivity.getTime();

      if (elapsedMs > timeoutMs) {
        // Agent is stuck
        this.emit('agentStuck', state.agentId, state.taskId, elapsedMs);

        // Abort the agent's execution
        if (state.abortController && !state.abortController.signal.aborted) {
          state.abortController.abort();
        }

        // Clean up this agent's state
        this.agentStates.delete(key);
      }
    }
  }

  private getEffectiveTimeout(state: AgentActivityState): number {
    // Use longer grace period during LLM requests
    if (this.config.gracePeriodsEnabled && state.inLlmRequest) {
      return this.config.llmRequestGracePeriodMs;
    }
    return this.config.activityTimeoutMs;
  }

  private countHandoffCycles(history: HandoffRecord[]): number {
    if (history.length < 2) {
      return 0;
    }

    let cycles = 0;
    const seen = new Set<string>();

    // Look for patterns like A->B->A (one cycle)
    for (let i = 0; i < history.length; i++) {
      const record = history[i]!;
      const pattern = `${record.from}->${record.to}`;

      // Check if we've seen this exact transition before
      if (seen.has(pattern)) {
        cycles++;
      }
      seen.add(pattern);
    }

    return cycles;
  }

  private getAgentKey(agentId: string, taskId: string): string {
    return `${agentId}:${taskId}`;
  }
}
