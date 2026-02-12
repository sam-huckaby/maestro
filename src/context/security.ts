import { minimatch } from 'minimatch';

// Patterns for files that should NEVER be read (security)
const SENSITIVE_PATTERNS = [
  // Environment files
  '.env',
  '.env.*',
  '*.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.env.staging',

  // Key and credential files
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '*.pub', // SSH public keys (less sensitive but often paired)

  // Credential files
  'credentials.json',
  'credentials.yaml',
  'credentials.yml',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  '.credentials',
  '.secrets',
  '**/secrets/**',

  // Cloud provider credentials
  '.aws/credentials',
  '.aws/config',
  '.gcloud/**',
  'gcloud.json',
  '.azure/**',
  'service-account*.json',

  // Database files
  '*.db',
  '*.sqlite',
  '*.sqlite3',

  // Auth tokens
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.docker/config.json',

  // History files (may contain secrets)
  '.bash_history',
  '.zsh_history',
  '.*_history',

  // Private keys and certificates
  '*.crt',
  '*.cer',
  'private.xml',
  'private.pem',

  // API key files
  'api_key*',
  'apikey*',
  '*_api_key*',
  '*_apikey*',
];

/**
 * Check if a file path matches sensitive file patterns
 */
export function isSensitiveFile(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').pop() || normalizedPath;

  for (const pattern of SENSITIVE_PATTERNS) {
    // Check against full path
    if (minimatch(normalizedPath, pattern, { dot: true })) {
      return true;
    }
    // Check against just the filename
    if (minimatch(fileName, pattern, { dot: true })) {
      return true;
    }
  }

  return false;
}

/**
 * Get all sensitive file patterns (for documentation/logging purposes)
 */
export function getSensitivePatterns(): string[] {
  return [...SENSITIVE_PATTERNS];
}

// Patterns for paths that should NEVER be written to (system/protected)
const PROTECTED_WRITE_PATTERNS = [
  // Git internals
  '.git/**',
  '.git',

  // Dependency directories
  'node_modules/**',
  'node_modules',

  // Build output directories
  'dist/**',
  'dist',
  'build/**',
  'build',

  // Lock files (prevent dependency corruption)
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',

  // IDE/Editor config directories
  '.idea/**',
  '.idea',
  '.vscode/**',
  '.vscode',
];

/**
 * Check if a path matches protected write patterns (system directories, lock files, etc.)
 */
export function isProtectedPath(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');

  for (const pattern of PROTECTED_WRITE_PATTERNS) {
    if (minimatch(normalizedPath, pattern, { dot: true })) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a path is unsafe to write to (combines sensitive file + protected path checks)
 */
export function isUnsafeWritePath(relativePath: string): boolean {
  return isSensitiveFile(relativePath) || isProtectedPath(relativePath);
}

/**
 * Get all protected write patterns (for documentation/logging purposes)
 */
export function getProtectedWritePatterns(): string[] {
  return [...PROTECTED_WRITE_PATTERNS];
}
