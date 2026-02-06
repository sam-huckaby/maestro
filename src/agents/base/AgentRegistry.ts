import type { Agent } from './Agent.js';
import type { AgentRole, ConfidenceScore } from './types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import { NoConfidentAgentError } from '../../utils/errors.js';

export interface AgentAssessment {
  agent: Agent;
  score: ConfidenceScore;
}

export class AgentRegistry {
  private agents: Map<string, Agent> = new Map();
  private roleIndex: Map<AgentRole, Set<string>> = new Map();

  register(agent: Agent): void {
    this.agents.set(agent.id, agent);

    if (!this.roleIndex.has(agent.role)) {
      this.roleIndex.set(agent.role, new Set());
    }
    this.roleIndex.get(agent.role)!.add(agent.id);
  }

  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    this.agents.delete(agentId);
    this.roleIndex.get(agent.role)?.delete(agentId);
    return true;
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  getByRole(role: AgentRole): Agent[] {
    const ids = this.roleIndex.get(role);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.agents.get(id)!);
  }

  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAllRoles(): AgentRole[] {
    return Array.from(this.roleIndex.keys());
  }

  async assessAll(
    task: Task,
    context: TaskContext,
    excludeRoles?: AgentRole[]
  ): Promise<AgentAssessment[]> {
    const agents = this.getAll().filter(
      (agent) => !excludeRoles?.includes(agent.role)
    );

    const assessments = await Promise.all(
      agents.map(async (agent) => {
        try {
          const score = await agent.assessTask(task, context);
          return { agent, score };
        } catch (error) {
          return {
            agent,
            score: {
              confidence: 0,
              reason: `Assessment failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          };
        }
      })
    );

    return assessments.sort((a, b) => b.score.confidence - a.score.confidence);
  }

  async selectBest(
    task: Task,
    context: TaskContext,
    threshold: number,
    excludeRoles?: AgentRole[]
  ): Promise<Agent> {
    const assessments = await this.assessAll(task, context, excludeRoles);

    if (assessments.length === 0) {
      throw new NoConfidentAgentError(task.id, [], threshold);
    }

    const best = assessments[0]!;
    if (best.score.confidence < threshold) {
      throw new NoConfidentAgentError(
        task.id,
        assessments.map((a) => ({ agentId: a.agent.id, confidence: a.score.confidence })),
        threshold
      );
    }

    return best.agent;
  }

  getIdleAgents(): Agent[] {
    return this.getAll().filter((agent) => agent.getStatus() === 'idle');
  }

  getBusyAgents(): Agent[] {
    return this.getAll().filter((agent) => agent.getStatus() === 'busy');
  }

  hasRole(role: AgentRole): boolean {
    const agents = this.roleIndex.get(role);
    return agents !== undefined && agents.size > 0;
  }

  count(): number {
    return this.agents.size;
  }

  clear(): void {
    this.agents.clear();
    this.roleIndex.clear();
  }
}

// Singleton instance
let registry: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!registry) {
    registry = new AgentRegistry();
  }
  return registry;
}

export function resetAgentRegistry(): void {
  if (registry) {
    registry.clear();
  }
  registry = null;
}
