import { Agent, type AgentDependencies } from '../base/Agent.js';
import type { AgentConfig, AgentResponse, Artifact } from '../base/types.js';
import type { Task, TaskContext } from '../../tasks/types.js';
import {
  REVIEWER_SYSTEM_PROMPT,
  REVIEWER_EXECUTION_PROMPT_TEMPLATE,
} from './prompts.js';

export type ReviewVerdict = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

export interface ReviewResult {
  verdict: ReviewVerdict;
  issues: ReviewIssue[];
  suggestions: string[];
  securityFindings: string[];
}

export interface ReviewIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  location?: string;
}

export class Reviewer extends Agent {
  constructor(dependencies: AgentDependencies, configOverrides?: Partial<AgentConfig>) {
    const config: AgentConfig = {
      id: configOverrides?.id ?? 'reviewer',
      role: 'reviewer',
      capabilities: ['review', 'testing', 'analysis'],
      confidenceThreshold: configOverrides?.confidenceThreshold ?? 0.6,
      maxRetries: configOverrides?.maxRetries ?? 3,
    };
    super(config, dependencies);
  }

  get systemPrompt(): string {
    return REVIEWER_SYSTEM_PROMPT;
  }

  protected buildExecutionPrompt(task: Task, context: TaskContext): string {
    const constraints = context.projectContext.constraints.length > 0
      ? context.projectContext.constraints.join('\n- ')
      : 'Standard best practices';

    const handoffContext = task.handoff.context || 'No implementation provided';

    let prompt = REVIEWER_EXECUTION_PROMPT_TEMPLATE
      .replace('{{goal}}', task.goal)
      .replace('{{description}}', task.description)
      .replace('{{projectName}}', context.projectContext.name)
      .replace('{{workingDirectory}}', context.projectContext.workingDirectory)
      .replace('{{constraints}}', constraints)
      .replace('{{handoffContext}}', handoffContext);

    // Include code artifacts to review
    if (task.handoff.artifacts.length > 0) {
      prompt += '\n\nCODE ARTIFACTS:\n';
      for (const artifact of task.handoff.artifacts) {
        prompt += `\n${artifact}\n`;
      }
    }

    return prompt;
  }

  protected parseExecutionResponse(response: string, task: Task): AgentResponse {
    const baseResponse = super.parseExecutionResponse(response, task);

    // Parse the review-specific content
    const reviewResult = this.parseReviewContent(response);

    // Add review artifact
    const reviewArtifact: Artifact = {
      id: `${task.id}_review`,
      type: 'review',
      name: 'Code Review',
      content: JSON.stringify(reviewResult, null, 2),
      metadata: {
        verdict: reviewResult.verdict,
        issueCount: reviewResult.issues.length,
        criticalCount: reviewResult.issues.filter((i) => i.severity === 'CRITICAL').length,
        highCount: reviewResult.issues.filter((i) => i.severity === 'HIGH').length,
      },
    };

    baseResponse.artifacts.push(reviewArtifact);

    // Determine next action based on verdict
    if (reviewResult.verdict === 'APPROVE') {
      baseResponse.nextAction = {
        type: 'complete',
        reason: 'Review passed - implementation approved',
      };
    } else if (reviewResult.verdict === 'REQUEST_CHANGES') {
      baseResponse.nextAction = {
        type: 'handoff',
        targetAgent: 'implementer',
        reason: `Review requested changes: ${reviewResult.issues.length} issues found`,
      };
    } else {
      baseResponse.nextAction = {
        type: 'escalate',
        reason: `Review rejected: ${reviewResult.issues.filter((i) => i.severity === 'CRITICAL').length} critical issues`,
      };
    }

    return baseResponse;
  }

  private parseReviewContent(response: string): ReviewResult {
    const result: ReviewResult = {
      verdict: 'REQUEST_CHANGES',
      issues: [],
      suggestions: [],
      securityFindings: [],
    };

    // Parse verdict
    if (response.includes('APPROVE')) {
      result.verdict = 'APPROVE';
    } else if (response.includes('REJECT')) {
      result.verdict = 'REJECT';
    }

    // Parse issues
    const issuePattern = /\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*(.+)/g;
    let match;
    while ((match = issuePattern.exec(response)) !== null) {
      result.issues.push({
        severity: match[1] as ReviewIssue['severity'],
        description: match[2]!.trim(),
      });
    }

    // Parse security findings (look for security section)
    const securityMatch = response.match(/Security.*?:([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
    if (securityMatch) {
      const findings = securityMatch[1]!.trim().split('\n').filter((l) => l.trim());
      result.securityFindings = findings.map((f) => f.replace(/^[-*]\s*/, '').trim());
    }

    // Parse suggestions
    const suggestionsMatch = response.match(/Suggestions.*?:([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
    if (suggestionsMatch) {
      const suggestions = suggestionsMatch[1]!.trim().split('\n').filter((l) => l.trim());
      result.suggestions = suggestions.map((s) => s.replace(/^[-*\d.]\s*/, '').trim());
    }

    return result;
  }
}

export function createReviewer(dependencies: AgentDependencies): Reviewer {
  return new Reviewer(dependencies);
}
