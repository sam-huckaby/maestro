export { FileContext } from './FileContext.js';
export type { FileNode, FileContextConfig, FileReadResult, FileWriteResult, FileEditResult, FileBackup } from './types.js';
export { createIgnoreFilter, loadGitignore, getDefaultIgnores } from './ignore.js';
export { isSensitiveFile, getSensitivePatterns, isProtectedPath, isUnsafeWritePath, getProtectedWritePatterns } from './security.js';
