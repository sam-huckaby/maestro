import ignore, { type Ignore } from 'ignore';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Default patterns to always ignore (not shown in tree)
const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '*.log',
  '.DS_Store',
  'package-lock.json',
  'bun.lockb',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.next',
  '.nuxt',
  '.cache',
  '__pycache__',
  '*.pyc',
  '.pytest_cache',
  'venv',
  '.venv',
  '.idea',
  '.vscode',
  '*.swp',
  '*.swo',
  'tmp',
  'temp',
  '.turbo',
];

/**
 * Load .gitignore patterns from a working directory
 */
export function loadGitignore(workingDir: string): string[] {
  const gitignorePath = join(workingDir, '.gitignore');

  if (!existsSync(gitignorePath)) {
    return [];
  }

  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Create an ignore filter that combines default ignores with .gitignore patterns
 */
export function createIgnoreFilter(
  workingDir: string,
  additionalPatterns: string[] = []
): (path: string) => boolean {
  const ig: Ignore = ignore();

  // Add default ignores
  ig.add(DEFAULT_IGNORES);

  // Add .gitignore patterns
  const gitignorePatterns = loadGitignore(workingDir);
  ig.add(gitignorePatterns);

  // Add any additional patterns
  if (additionalPatterns.length > 0) {
    ig.add(additionalPatterns);
  }

  return (relativePath: string): boolean => {
    // Empty path should not be ignored
    if (!relativePath) {
      return false;
    }
    return ig.ignores(relativePath);
  };
}

/**
 * Get all default ignore patterns
 */
export function getDefaultIgnores(): string[] {
  return [...DEFAULT_IGNORES];
}
