import type { LLMProvider } from '../../llm/types.js';
import type { Task, TaskDecomposition, ProjectContext } from '../../tasks/types.js';
import { createTask } from '../../tasks/Task.js';

const TASK_PLANNER_PROMPT = `You are a task planning agent. Your job is to break down a high-level goal into actionable tasks.

For each task, identify:
1. A clear, specific goal
2. A detailed description
3. Dependencies on other tasks (if any)
4. The type of work (design, implementation, review, etc.)

Output your plan as a JSON array of tasks with this structure:
{
  "tasks": [
    {
      "goal": "Short task goal",
      "description": "Detailed description of what needs to be done",
      "type": "design|implementation|review|testing|documentation",
      "dependencies": [] // indices of tasks this depends on (0-based)
    }
  ]
}

Guidelines:
- Break complex goals into 3-7 manageable tasks
- Ensure tasks have clear boundaries
- Order tasks logically (design before implementation, implementation before review)
- Make each task specific enough to be actionable
- Include a review task for any implementation work`;

export interface TaskPlannerConfig {
  llmProvider: LLMProvider;
}

export class TaskPlanner {
  private llm: LLMProvider;

  constructor(config: TaskPlannerConfig) {
    this.llm = config.llmProvider;
  }

  async decompose(
    goal: string,
    projectContext: ProjectContext
  ): Promise<TaskDecomposition> {
    const prompt = this.buildPlanningPrompt(goal, projectContext);

    const response = await this.llm.complete({
      system: TASK_PLANNER_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.5,
    });

    const parsed = this.parsePlanResponse(response.content, goal);
    return this.buildDecomposition(goal, parsed);
  }

  private buildPlanningPrompt(goal: string, context: ProjectContext): string {
    return `
Break down this goal into actionable tasks:

GOAL: ${goal}

PROJECT CONTEXT:
- Name: ${context.name}
- Description: ${context.description}
- Working Directory: ${context.workingDirectory}
- Constraints: ${context.constraints.join(', ') || 'None'}

Create a logical task breakdown with clear dependencies.
`.trim();
  }

  private parsePlanResponse(
    response: string,
    originalGoal: string
  ): Array<{
    goal: string;
    description: string;
    type: string;
    dependencies: number[];
  }> {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.tasks)) {
          return parsed.tasks;
        }
      }
    } catch {
      // Fall through to default
    }

    // Default single task if parsing fails
    return [
      {
        goal: originalGoal,
        description: originalGoal,
        type: 'implementation',
        dependencies: [],
      },
    ];
  }

  private buildDecomposition(
    originalGoal: string,
    parsed: Array<{
      goal: string;
      description: string;
      type: string;
      dependencies: number[];
    }>
  ): TaskDecomposition {
    const tasks: Task[] = [];
    const dependencyGraph = new Map<string, string[]>();

    // First pass: create all tasks
    for (const item of parsed) {
      const task = createTask({
        goal: item.goal,
        description: item.description,
        metadata: { taskType: item.type },
      });
      tasks.push(task);
    }

    // Second pass: resolve dependencies
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i]!;
      const task = tasks[i]!;
      const deps: string[] = [];

      for (const depIndex of item.dependencies) {
        if (depIndex >= 0 && depIndex < tasks.length && depIndex !== i) {
          const depTask = tasks[depIndex]!;
          deps.push(depTask.id);
          task.dependencies.push(depTask.id);
        }
      }

      dependencyGraph.set(task.id, deps);
    }

    return {
      originalGoal,
      tasks,
      dependencyGraph,
    };
  }

  async refineTask(
    task: Task,
    feedback: string,
    projectContext: ProjectContext
  ): Promise<Task[]> {
    const prompt = `
The following task needs refinement based on feedback:

TASK: ${task.goal}
DESCRIPTION: ${task.description}

FEEDBACK: ${feedback}

PROJECT CONTEXT:
- Name: ${projectContext.name}
- Constraints: ${projectContext.constraints.join(', ') || 'None'}

Break this task into smaller, more specific subtasks if needed.
Or provide a single refined task if the feedback can be addressed directly.
`.trim();

    const response = await this.llm.complete({
      system: TASK_PLANNER_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
      temperature: 0.5,
    });

    const parsed = this.parsePlanResponse(response.content, task.goal);

    return parsed.map((item) =>
      createTask({
        goal: item.goal,
        description: item.description,
        metadata: { parentTaskId: task.id, taskType: item.type },
      })
    );
  }
}
