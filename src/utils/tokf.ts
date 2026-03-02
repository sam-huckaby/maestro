import { execSync } from 'child_process';

let tokfAvailable: boolean | null = null;

/**
 * Check whether tokf is installed and available on PATH.
 * The result is cached after the first call.
 *
 * @see https://github.com/mpecan/tokf
 */
export function isTokfAvailable(): boolean {
  if (tokfAvailable !== null) {
    return tokfAvailable;
  }

  try {
    execSync('tokf --version', { stdio: 'ignore', timeout: 5000 });
    tokfAvailable = true;
  } catch {
    tokfAvailable = false;
  }

  return tokfAvailable;
}

/**
 * Wrap a shell command with `tokf run` so its output is compressed
 * before reaching the LLM context window.
 *
 * Uses `--no-mask-exit-code` so the real exit code propagates back
 * to the caller (maestro relies on exit codes for success/failure
 * detection).
 */
export function wrapWithTokf(command: string): string {
  return `tokf run --no-mask-exit-code ${command}`;
}

/**
 * Reset the cached detection result.  Useful for testing.
 */
export function resetTokfCache(): void {
  tokfAvailable = null;
}
