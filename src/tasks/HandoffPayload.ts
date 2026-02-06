import type { HandoffPayload, Task, TaskAttempt } from './types.js';
import type { AgentResponse, Artifact } from '../agents/base/types.js';

export function createHandoffPayload(
  task: string,
  context: string,
  constraints: string[] = [],
  artifacts: string[] = []
): HandoffPayload {
  return {
    task,
    context,
    constraints,
    artifacts,
  };
}

export function updateHandoffWithResponse(
  handoff: HandoffPayload,
  response: AgentResponse
): HandoffPayload {
  const newArtifacts = response.artifacts.map((a) => formatArtifact(a));

  return {
    ...handoff,
    context: `${handoff.context}\n\nPrevious output:\n${response.output.slice(0, 2000)}`,
    artifacts: [...handoff.artifacts, ...newArtifacts],
  };
}

export function formatArtifact(artifact: Artifact): string {
  const header = `=== ${artifact.type.toUpperCase()}: ${artifact.name} ===`;
  return `${header}\n${artifact.content}\n`;
}

export function createHandoffFromTask(
  sourceTask: Task,
  additionalContext?: string
): HandoffPayload {
  const lastAttempt = sourceTask.attempts[sourceTask.attempts.length - 1];

  let context = sourceTask.handoff.context;
  if (lastAttempt?.output) {
    context += `\n\nPrevious work:\n${lastAttempt.output}`;
  }
  if (additionalContext) {
    context += `\n\n${additionalContext}`;
  }

  // Collect all artifacts from successful attempts
  const artifacts = sourceTask.attempts
    .filter((a) => a.success)
    .flatMap((a) => a.artifacts.map(formatArtifact));

  return {
    task: sourceTask.goal,
    context,
    constraints: sourceTask.handoff.constraints,
    artifacts: [...sourceTask.handoff.artifacts, ...artifacts],
  };
}

export function mergeHandoffs(...handoffs: HandoffPayload[]): HandoffPayload {
  const contexts: string[] = [];
  const constraints = new Set<string>();
  const artifacts: string[] = [];

  for (const handoff of handoffs) {
    if (handoff.context) {
      contexts.push(handoff.context);
    }
    for (const constraint of handoff.constraints) {
      constraints.add(constraint);
    }
    artifacts.push(...handoff.artifacts);
  }

  return {
    task: handoffs[0]?.task || '',
    context: contexts.join('\n\n---\n\n'),
    constraints: Array.from(constraints),
    artifacts,
  };
}

export function summarizeAttempts(attempts: TaskAttempt[]): string {
  if (attempts.length === 0) {
    return 'No previous attempts.';
  }

  const lines: string[] = [`Previous attempts (${attempts.length}):`];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i]!;
    const status = attempt.success ? 'SUCCESS' : 'FAILED';
    const duration = attempt.completedAt
      ? `${(attempt.completedAt.getTime() - attempt.startedAt.getTime()) / 1000}s`
      : 'ongoing';

    lines.push(`  ${i + 1}. [${status}] by ${attempt.agentRole} (${duration})`);

    if (attempt.error) {
      lines.push(`     Error: ${attempt.error.slice(0, 100)}`);
    }
  }

  return lines.join('\n');
}
