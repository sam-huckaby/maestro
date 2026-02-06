import ora, { type Ora } from 'ora';
import chalk from 'chalk';

export interface SpinnerOptions {
  text: string;
  color?: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'magenta' | 'white';
  enabled?: boolean;
}

export class Spinner {
  private spinner: Ora | null = null;
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  start(options: SpinnerOptions | string): this {
    if (!this.enabled) return this;

    const opts = typeof options === 'string' ? { text: options } : options;
    this.spinner = ora({
      text: opts.text,
      color: opts.color ?? 'cyan',
    }).start();
    return this;
  }

  stop(): this {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
    return this;
  }

  succeed(text?: string): this {
    if (this.spinner) {
      this.spinner.succeed(text);
      this.spinner = null;
    }
    return this;
  }

  fail(text?: string): this {
    if (this.spinner) {
      this.spinner.fail(text);
      this.spinner = null;
    }
    return this;
  }

  warn(text?: string): this {
    if (this.spinner) {
      this.spinner.warn(text);
      this.spinner = null;
    }
    return this;
  }

  info(text?: string): this {
    if (this.spinner) {
      this.spinner.info(text);
      this.spinner = null;
    }
    return this;
  }

  update(text: string): this {
    if (this.spinner) {
      this.spinner.text = text;
    }
    return this;
  }

  setColor(color: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'magenta' | 'white'): this {
    if (this.spinner) {
      this.spinner.color = color;
    }
    return this;
  }

  isSpinning(): boolean {
    return this.spinner?.isSpinning ?? false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.spinner) {
      this.stop();
    }
  }
}

export function createAgentSpinner(agentName: string, action: string): Spinner {
  const spinner = new Spinner();
  const label = chalk.cyan(`[${agentName}]`);
  spinner.start({ text: `${label} ${action}`, color: 'cyan' });
  return spinner;
}

export function createTaskSpinner(taskDescription: string): Spinner {
  const spinner = new Spinner();
  spinner.start({ text: taskDescription, color: 'blue' });
  return spinner;
}
