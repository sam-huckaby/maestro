import type { Agent } from '../base/Agent.js';
import type { AgentRegistry, AgentAssessment } from '../base/AgentRegistry.js';
import type { AgentRole, ConfidenceScore } from '../base/types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import { NoConfidentAgentError } from '../../utils/errors.js';

export interface RouterConfig {
  confidenceThreshold: number;
  parallelAssessment: boolean;
  recoveryEnabled: boolean;
}

export interface RecoveryResult {
  attempted: boolean;
  agent?: Agent;
  originalScore?: ConfidenceScore;
  enhancedScore?: ConfidenceScore;
  success: boolean;
}

export interface RoutingDecision {
  selectedAgent: Agent;
  score: ConfidenceScore;
  alternatives: AgentAssessment[];
  reason: string;
  recoveryAttempt?: RecoveryResult;
}

export class ConfidenceRouter {
  private config: RouterConfig;
  private registry: AgentRegistry;

  constructor(registry: AgentRegistry, config: Partial<RouterConfig> = {}) {
    this.registry = registry;
    this.config = {
      confidenceThreshold: config.confidenceThreshold ?? 0.6,
      parallelAssessment: config.parallelAssessment ?? true,
      recoveryEnabled: config.recoveryEnabled ?? true,
    };
  }

  async route(
    task: Task,
    context: TaskContext,
    excludeRoles?: AgentRole[]
  ): Promise<RoutingDecision> {
    // Get all eligible agents
    const agents = this.registry.getAll().filter(
      (agent) => !excludeRoles?.includes(agent.role) && agent.getStatus() === 'idle'
    );

    if (agents.length === 0) {
      throw new NoConfidentAgentError(task.id, [], this.config.confidenceThreshold);
    }

    // Assess all agents (parallel or sequential based on config)
    const assessments = this.config.parallelAssessment
      ? await this.assessParallel(agents, task, context)
      : await this.assessSequential(agents, task, context);

    // Sort by confidence (highest first)
    assessments.sort((a, b) => b.score.confidence - a.score.confidence);

    // Check if best agent meets threshold
    const best = assessments[0];
    if (!best || best.score.confidence < this.config.confidenceThreshold) {
      // Attempt recovery before failing
      if (this.config.recoveryEnabled) {
        const recoveryResult = await this.attemptRecovery(task, context, assessments);

        if (recoveryResult.success && recoveryResult.agent && recoveryResult.enhancedScore) {
          return {
            selectedAgent: recoveryResult.agent,
            score: recoveryResult.enhancedScore,
            alternatives: assessments.filter((a) => a.agent.id !== recoveryResult.agent!.id),
            reason: `Recovery successful: ${recoveryResult.agent.role} improved from ${recoveryResult.originalScore?.confidence.toFixed(2)} to ${recoveryResult.enhancedScore.confidence.toFixed(2)}`,
            recoveryAttempt: recoveryResult,
          };
        }
      }

      // Recovery failed or disabled - throw original error
      throw new NoConfidentAgentError(
        task.id,
        assessments.map((a) => ({
          agentId: a.agent.id,
          confidence: a.score.confidence,
        })),
        this.config.confidenceThreshold,
        this.config.recoveryEnabled
      );
    }

    return {
      selectedAgent: best.agent,
      score: best.score,
      alternatives: assessments.slice(1),
      reason: this.buildRoutingReason(best, assessments),
    };
  }

  async routeWithPreference(
    task: Task,
    context: TaskContext,
    preferredRole: AgentRole
  ): Promise<RoutingDecision> {
    // First try the preferred role
    const preferredAgents = this.registry.getByRole(preferredRole);
    const idlePreferred = preferredAgents.filter((a) => a.getStatus() === 'idle');

    if (idlePreferred.length > 0) {
      const assessments = await this.assessParallel(idlePreferred, task, context);
      const best = assessments.sort((a, b) => b.score.confidence - a.score.confidence)[0];

      if (best && best.score.confidence >= this.config.confidenceThreshold) {
        return {
          selectedAgent: best.agent,
          score: best.score,
          alternatives: assessments.slice(1),
          reason: `Preferred role '${preferredRole}' agent selected with confidence ${best.score.confidence.toFixed(2)}`,
        };
      }
    }

    // Fall back to general routing
    return this.route(task, context);
  }

  async assessForRole(
    task: Task,
    context: TaskContext,
    role: AgentRole
  ): Promise<AgentAssessment[]> {
    const agents = this.registry.getByRole(role);
    return this.assessParallel(agents, task, context);
  }

  private async assessParallel(
    agents: Agent[],
    task: Task,
    context: TaskContext
  ): Promise<AgentAssessment[]> {
    const results = await Promise.all(
      agents.map(async (agent) => {
        try {
          const score = await agent.assessTask(task, context);
          return { agent, score };
        } catch (error) {
          return {
            agent,
            score: {
              confidence: 0,
              reason: `Assessment error: ${error instanceof Error ? error.message : String(error)}`,
            },
          };
        }
      })
    );

    return results;
  }

  private async assessSequential(
    agents: Agent[],
    task: Task,
    context: TaskContext
  ): Promise<AgentAssessment[]> {
    const results: AgentAssessment[] = [];

    for (const agent of agents) {
      try {
        const score = await agent.assessTask(task, context);
        results.push({ agent, score });

        // Early exit if we find a highly confident agent
        if (score.confidence >= 0.9) {
          break;
        }
      } catch (error) {
        results.push({
          agent,
          score: {
            confidence: 0,
            reason: `Assessment error: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
    }

    return results;
  }

  private buildRoutingReason(
    selected: AgentAssessment,
    all: AgentAssessment[]
  ): string {
    const alternatives = all
      .filter((a) => a.agent.id !== selected.agent.id)
      .slice(0, 2)
      .map((a) => `${a.agent.role}:${a.score.confidence.toFixed(2)}`)
      .join(', ');

    const altText = alternatives ? ` (alternatives: ${alternatives})` : '';

    return `Selected ${selected.agent.role} with confidence ${selected.score.confidence.toFixed(2)}${altText}. Reason: ${selected.score.reason}`;
  }

  setThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Confidence threshold must be between 0 and 1');
    }
    this.config.confidenceThreshold = threshold;
  }

  getThreshold(): number {
    return this.config.confidenceThreshold;
  }

  private async attemptRecovery(
    task: Task,
    context: TaskContext,
    assessments: AgentAssessment[]
  ): Promise<RecoveryResult> {
    // Select candidate: idle agent with LOWEST confidence (most room to improve)
    const candidate = this.selectRecoveryCandidate(assessments);
    if (!candidate) {
      return { attempted: false, success: false };
    }

    // Enhance context with task-specific information
    const enhancedContext = this.enhanceContext(task, context, candidate.agent);

    // Re-assess with enhanced context
    try {
      const enhancedScore = await candidate.agent.assessTask(task, enhancedContext);

      return {
        attempted: true,
        agent: candidate.agent,
        originalScore: candidate.score,
        enhancedScore,
        success: enhancedScore.confidence >= this.config.confidenceThreshold,
      };
    } catch {
      return { attempted: true, success: false };
    }
  }

  private selectRecoveryCandidate(assessments: AgentAssessment[]): AgentAssessment | null {
    // Filter to idle agents only
    const idleAssessments = assessments.filter((a) => a.agent.getStatus() === 'idle');
    if (idleAssessments.length === 0) return null;

    // Select agent with LOWEST confidence - most room for improvement
    // Assessments are sorted highest first, so get the last one
    return idleAssessments[idleAssessments.length - 1] ?? null;
  }

  private enhanceContext(_task: Task, context: TaskContext, agent: Agent): TaskContext {
    // Add hints to help the agent understand the task better
    const recoveryHints = [
      `RECOVERY HINT: You are being asked to reconsider this task.`,
      `Your capabilities (${agent.capabilities.join(', ')}) are relevant here.`,
      `Focus on what you CAN do. A partial solution is better than no solution.`,
      `Consider: Can you handle just the core requirement?`,
    ].join('\n');

    return {
      ...context,
      projectContext: {
        ...context.projectContext,
        constraints: [
          ...context.projectContext.constraints,
          'Partial solutions are acceptable',
          'Focus on core requirements first',
        ],
      },
      executionHistory: [
        ...context.executionHistory,
        {
          agentId: 'system',
          agentRole: agent.role,
          startedAt: new Date(),
          success: false,
          output: recoveryHints,
          artifacts: [],
        },
      ],
    };
  }
}
