export interface FileNode {
  name: string;
  path: string; // relative to workingDirectory
  type: 'file' | 'directory';
  children?: FileNode[]; // only for directories
  size?: number; // bytes, only for files
  extension?: string; // only for files
}

export interface FileContextConfig {
  workingDirectory: string;
  maxFileSize?: number; // default 100KB
  maxTreeDepth?: number; // default 10
  includePatterns?: string[]; // glob patterns to include
  excludePatterns?: string[]; // additional patterns to exclude
}

export interface FileReadResult {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
}

export interface FileWriteResult {
  path: string;
  bytesWritten: number;
  created: boolean; // true if new file, false if overwritten
  backedUp: boolean; // true if backup was created before write
}

export interface FileEditResult {
  path: string;
  replacements: number;
  bytesWritten: number;
}

export interface FileBackup {
  path: string;
  content: string;
  timestamp: Date;
}
