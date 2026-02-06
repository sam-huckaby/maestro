import chalk from 'chalk';
import { Spinner } from './spinner.js';

export interface ProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  message?: string;
}

export class MultiStepProgress {
  private steps: ProgressStep[];
  private currentSpinner: Spinner | null = null;
  private enabled: boolean;

  constructor(steps: Array<{ id: string; label: string }>, enabled = true) {
    this.steps = steps.map((step) => ({
      ...step,
      status: 'pending' as const,
    }));
    this.enabled = enabled;
  }

  start(stepId: string, message?: string): void {
    const step = this.findStep(stepId);
    if (!step) return;

    this.stopCurrentSpinner();
    step.status = 'in_progress';
    step.message = message;

    if (this.enabled) {
      this.currentSpinner = new Spinner();
      this.currentSpinner.start({
        text: this.formatStep(step),
        color: 'cyan',
      });
    }
  }

  update(stepId: string, message: string): void {
    const step = this.findStep(stepId);
    if (!step) return;

    step.message = message;
    if (this.currentSpinner && step.status === 'in_progress') {
      this.currentSpinner.update(this.formatStep(step));
    }
  }

  complete(stepId: string, message?: string): void {
    const step = this.findStep(stepId);
    if (!step) return;

    step.status = 'completed';
    step.message = message;

    if (this.currentSpinner) {
      this.currentSpinner.succeed(this.formatStep(step));
      this.currentSpinner = null;
    }
  }

  fail(stepId: string, message?: string): void {
    const step = this.findStep(stepId);
    if (!step) return;

    step.status = 'failed';
    step.message = message;

    if (this.currentSpinner) {
      this.currentSpinner.fail(this.formatStep(step));
      this.currentSpinner = null;
    }
  }

  skip(stepId: string, message?: string): void {
    const step = this.findStep(stepId);
    if (!step) return;

    step.status = 'skipped';
    step.message = message;

    if (this.currentSpinner) {
      this.currentSpinner.info(this.formatStep(step));
      this.currentSpinner = null;
    }
  }

  warn(stepId: string, message: string): void {
    const step = this.findStep(stepId);
    if (!step) return;

    step.message = message;

    if (this.currentSpinner) {
      this.currentSpinner.warn(this.formatStep(step));
      this.currentSpinner = null;
    }
  }

  getStatus(): ProgressStep[] {
    return [...this.steps];
  }

  getSummary(): { completed: number; failed: number; total: number } {
    return {
      completed: this.steps.filter((s) => s.status === 'completed').length,
      failed: this.steps.filter((s) => s.status === 'failed').length,
      total: this.steps.length,
    };
  }

  printSummary(): void {
    if (!this.enabled) return;

    console.log();
    console.log(chalk.bold('Summary:'));

    for (const step of this.steps) {
      const icon = this.getStatusIcon(step.status);
      const label = this.colorizeByStatus(step.label, step.status);
      const message = step.message ? chalk.gray(` - ${step.message}`) : '';
      console.log(`  ${icon} ${label}${message}`);
    }

    const summary = this.getSummary();
    console.log();
    if (summary.failed > 0) {
      console.log(chalk.red(`${summary.failed} step(s) failed`));
    } else {
      console.log(chalk.green(`All ${summary.completed} steps completed successfully`));
    }
  }

  private findStep(stepId: string): ProgressStep | undefined {
    return this.steps.find((s) => s.id === stepId);
  }

  private stopCurrentSpinner(): void {
    if (this.currentSpinner) {
      this.currentSpinner.stop();
      this.currentSpinner = null;
    }
  }

  private formatStep(step: ProgressStep): string {
    const message = step.message ? `: ${step.message}` : '';
    return `${step.label}${message}`;
  }

  private getStatusIcon(status: ProgressStep['status']): string {
    switch (status) {
      case 'completed':
        return chalk.green('✓');
      case 'failed':
        return chalk.red('✗');
      case 'skipped':
        return chalk.gray('○');
      case 'in_progress':
        return chalk.cyan('●');
      default:
        return chalk.gray('○');
    }
  }

  private colorizeByStatus(text: string, status: ProgressStep['status']): string {
    switch (status) {
      case 'completed':
        return chalk.green(text);
      case 'failed':
        return chalk.red(text);
      case 'skipped':
        return chalk.gray(text);
      case 'in_progress':
        return chalk.cyan(text);
      default:
        return chalk.gray(text);
    }
  }
}

export function createShipProgress(): MultiStepProgress {
  return new MultiStepProgress([
    { id: 'plan', label: 'Plan created' },
    { id: 'architect', label: 'Architect designing' },
    { id: 'implement', label: 'Implementer coding' },
    { id: 'review', label: 'Reviewer auditing' },
    { id: 'complete', label: 'Feature complete' },
  ]);
}
