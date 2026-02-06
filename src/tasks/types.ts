import { z } from 'zod';
import type { AgentRole, Artifact } from '../agents/base/types.js';

export const TaskStatusSchema = z.enum([
  'pending',
  'assigned',
  'in_progress',
  'reviewing',
  'completed',
  'failed',
  'blocked',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export interface HandoffPayload {
  task: string;
  context: string;
  constraints: string[];
  artifacts: string[];
  previousAttempts?: TaskAttempt[];
}

export interface TaskAttempt {
  agentId: string;
  agentRole: AgentRole;
  startedAt: Date;
  completedAt?: Date;
  success: boolean;
  output?: string;
  error?: string;
  artifacts: Artifact[];
}

export interface Task {
  id: string;
  goal: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: AgentRole;
  handoff: HandoffPayload;
  attempts: TaskAttempt[];
  dependencies: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  output: string;
  artifacts: Artifact[];
  duration: number;
  agentRole: AgentRole;
}

export interface TaskContext {
  parentTask?: Task;
  relatedTasks: Task[];
  projectContext: ProjectContext;
  executionHistory: TaskAttempt[];
}

export interface ProjectContext {
  name: string;
  description: string;
  workingDirectory: string;
  constraints: string[];
  preferences: Record<string, unknown>;
}

export interface TaskDecomposition {
  originalGoal: string;
  tasks: Task[];
  dependencyGraph: Map<string, string[]>;
}
