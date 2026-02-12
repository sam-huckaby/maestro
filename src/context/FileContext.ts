import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { minimatch } from 'minimatch';
import type { FileNode, FileContextConfig, FileReadResult, FileWriteResult, FileEditResult, FileBackup } from './types.js';
import { createIgnoreFilter } from './ignore.js';
import { isSensitiveFile, isUnsafeWritePath } from './security.js';
import { ensureDirectory } from '../utils/fs.js';

const DEFAULT_MAX_FILE_SIZE = 100 * 1024; // 100KB
const DEFAULT_MAX_TREE_DEPTH = 10;

export class FileContext {
  private config: FileContextConfig;
  private fileTree: FileNode[] | null = null;
  private filesRead: Set<string> = new Set();
  private fileContents: Map<string, string> = new Map();
  private ignoreFilter: (path: string) => boolean;
  private filesWritten: Set<string> = new Set();
  private backups: Map<string, FileBackup> = new Map();

  constructor(config: FileContextConfig) {
    this.config = {
      maxFileSize: DEFAULT_MAX_FILE_SIZE,
      maxTreeDepth: DEFAULT_MAX_TREE_DEPTH,
      ...config,
    };
    this.ignoreFilter = createIgnoreFilter(
      config.workingDirectory,
      config.excludePatterns
    );
  }

  /**
   * Build/get the file tree (lazy loaded)
   */
  async getFileTree(): Promise<FileNode[]> {
    if (this.fileTree) {
      return this.fileTree;
    }

    this.fileTree = this.buildFileTree(
      this.config.workingDirectory,
      '',
      0
    );
    return this.fileTree;
  }

  /**
   * Read a specific file, tracks in filesRead
   */
  async readFile(relativePath: string): Promise<FileReadResult> {
    // Check cache first
    if (this.fileContents.has(relativePath)) {
      const content = this.fileContents.get(relativePath)!;
      return {
        path: relativePath,
        content,
        truncated: false,
        size: Buffer.byteLength(content, 'utf-8'),
      };
    }

    const absolutePath = join(this.config.workingDirectory, relativePath);

    // Validate file exists
    if (!existsSync(absolutePath)) {
      throw new Error(`File not found: ${relativePath}`);
    }

    // Get file stats
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      throw new Error(`Cannot read directory as file: ${relativePath}`);
    }

    const maxSize = this.config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    let content: string;
    let truncated = false;

    if (stats.size > maxSize) {
      // Read only up to maxSize bytes
      const buffer = Buffer.alloc(maxSize);
      const fd = require('node:fs').openSync(absolutePath, 'r');
      require('node:fs').readSync(fd, buffer, 0, maxSize, 0);
      require('node:fs').closeSync(fd);
      content = buffer.toString('utf-8');
      truncated = true;
    } else {
      content = readFileSync(absolutePath, 'utf-8');
    }

    // Track the read
    this.filesRead.add(relativePath);
    this.fileContents.set(relativePath, content);

    return {
      path: relativePath,
      content,
      truncated,
      size: stats.size,
    };
  }

  /**
   * Check if a file has been read
   */
  hasRead(relativePath: string): boolean {
    return this.filesRead.has(relativePath);
  }

  /**
   * Get all files that have been read
   */
  getFilesRead(): string[] {
    return Array.from(this.filesRead);
  }

  /**
   * Write content to a file (creates if not exists, overwrites if exists)
   * @param relativePath - Path relative to working directory
   * @param content - Content to write
   * @param options - { overwrite?: boolean } - if true, skips read-before-write check
   */
  async writeFile(
    relativePath: string,
    content: string,
    options?: { overwrite?: boolean }
  ): Promise<FileWriteResult> {
    // SECURITY: Block writes to sensitive/protected paths
    if (isUnsafeWritePath(relativePath)) {
      throw new Error(`Cannot write to protected path: ${relativePath}`);
    }

    const absolutePath = join(this.config.workingDirectory, relativePath);
    const fileExists = existsSync(absolutePath);

    // Enforce read-before-write unless overwrite is explicitly set
    if (fileExists && !options?.overwrite && !this.hasRead(relativePath)) {
      throw new Error(
        `Must read file before overwriting: ${relativePath}. Use read_file first or set overwrite: true.`
      );
    }

    // Create backup if file exists
    let backedUp = false;
    if (fileExists) {
      const existingContent = readFileSync(absolutePath, 'utf-8');
      this.backups.set(relativePath, {
        path: relativePath,
        content: existingContent,
        timestamp: new Date(),
      });
      backedUp = true;
    }

    // Ensure directory exists
    await ensureDirectory(dirname(absolutePath));

    // Write the file
    writeFileSync(absolutePath, content, 'utf-8');

    // Track the write
    this.filesWritten.add(relativePath);

    // Update cache
    this.fileContents.set(relativePath, content);
    this.filesRead.add(relativePath);

    // Invalidate file tree cache since we modified the filesystem
    this.fileTree = null;

    return {
      path: relativePath,
      bytesWritten: Buffer.byteLength(content, 'utf-8'),
      created: !fileExists,
      backedUp,
    };
  }

  /**
   * Edit a file using search/replace
   * @param relativePath - Path relative to working directory
   * @param oldContent - Content to find and replace
   * @param newContent - Content to replace with
   */
  async editFile(
    relativePath: string,
    oldContent: string,
    newContent: string
  ): Promise<FileEditResult> {
    // SECURITY: Block writes to sensitive/protected paths
    if (isUnsafeWritePath(relativePath)) {
      throw new Error(`Cannot edit protected path: ${relativePath}`);
    }

    const absolutePath = join(this.config.workingDirectory, relativePath);

    // File must exist for edit
    if (!existsSync(absolutePath)) {
      throw new Error(`File not found: ${relativePath}`);
    }

    // Enforce read-before-edit
    if (!this.hasRead(relativePath)) {
      throw new Error(`Must read file before editing: ${relativePath}. Use read_file first.`);
    }

    // Read current content
    const currentContent = readFileSync(absolutePath, 'utf-8');

    // Check if old content exists
    if (!currentContent.includes(oldContent)) {
      throw new Error(
        `Search content not found in file: ${relativePath}. Make sure the old_content exactly matches the file content.`
      );
    }

    // Create backup before edit
    this.backups.set(relativePath, {
      path: relativePath,
      content: currentContent,
      timestamp: new Date(),
    });

    // Count replacements
    const replacements = currentContent.split(oldContent).length - 1;

    // Perform replacement (all occurrences)
    const updatedContent = currentContent.split(oldContent).join(newContent);

    // Write the file
    writeFileSync(absolutePath, updatedContent, 'utf-8');

    // Track the write
    this.filesWritten.add(relativePath);

    // Update cache
    this.fileContents.set(relativePath, updatedContent);

    // Invalidate file tree cache
    this.fileTree = null;

    return {
      path: relativePath,
      replacements,
      bytesWritten: Buffer.byteLength(updatedContent, 'utf-8'),
    };
  }

  /**
   * Restore a file from backup
   * @param relativePath - Path relative to working directory
   */
  async restoreFile(relativePath: string): Promise<boolean> {
    const backup = this.backups.get(relativePath);
    if (!backup) {
      return false;
    }

    const absolutePath = join(this.config.workingDirectory, relativePath);

    // Write backup content
    writeFileSync(absolutePath, backup.content, 'utf-8');

    // Update cache
    this.fileContents.set(relativePath, backup.content);

    // Remove from backups (one-time restore)
    this.backups.delete(relativePath);

    // Invalidate file tree cache
    this.fileTree = null;

    return true;
  }

  /**
   * Check if a file has been written
   */
  hasWritten(relativePath: string): boolean {
    return this.filesWritten.has(relativePath);
  }

  /**
   * Get all files that have been written
   */
  getFilesWritten(): string[] {
    return Array.from(this.filesWritten);
  }

  /**
   * Check if a file has a backup
   */
  hasBackup(relativePath: string): boolean {
    return this.backups.has(relativePath);
  }

  /**
   * Clear all backups
   */
  clearBackups(): void {
    this.backups.clear();
  }

  /**
   * Search files by glob pattern
   */
  async findFiles(pattern: string): Promise<string[]> {
    const tree = await this.getFileTree();
    const matches: string[] = [];

    const searchNode = (nodes: FileNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'file') {
          if (minimatch(node.path, pattern, { dot: true })) {
            matches.push(node.path);
          }
        } else if (node.children) {
          searchNode(node.children);
        }
      }
    };

    searchNode(tree);
    return matches;
  }

  /**
   * Get formatted tree string for LLM context
   */
  formatTreeForPrompt(maxLines: number = 100): string {
    if (!this.fileTree) {
      this.fileTree = this.buildFileTree(
        this.config.workingDirectory,
        '',
        0
      );
    }

    const lines: string[] = [];
    this.formatNode(this.fileTree, '', lines, maxLines);

    if (lines.length >= maxLines) {
      lines.push('... (truncated)');
    }

    return lines.join('\n');
  }

  private buildFileTree(
    dirPath: string,
    relativePath: string,
    depth: number
  ): FileNode[] {
    const maxDepth = this.config.maxTreeDepth ?? DEFAULT_MAX_TREE_DEPTH;
    if (depth >= maxDepth) {
      return [];
    }

    const nodes: FileNode[] = [];

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelativePath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;

        // Skip ignored files
        if (this.ignoreFilter(entryRelativePath)) {
          continue;
        }

        // Skip sensitive files from tree display
        if (entry.isFile() && isSensitiveFile(entryRelativePath)) {
          continue;
        }

        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const children = this.buildFileTree(
            fullPath,
            entryRelativePath,
            depth + 1
          );
          // Only include directories that have visible children
          if (children.length > 0) {
            nodes.push({
              name: entry.name,
              path: entryRelativePath,
              type: 'directory',
              children,
            });
          }
        } else if (entry.isFile()) {
          try {
            const stats = statSync(fullPath);
            nodes.push({
              name: entry.name,
              path: entryRelativePath,
              type: 'file',
              size: stats.size,
              extension: extname(entry.name).slice(1) || undefined,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }

      // Sort: directories first, then files, alphabetically
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch {
      // Return empty array if we can't read the directory
    }

    return nodes;
  }

  private formatNode(
    nodes: FileNode[],
    prefix: string,
    lines: string[],
    maxLines: number
  ): void {
    for (let i = 0; i < nodes.length && lines.length < maxLines; i++) {
      const node = nodes[i]!;
      const isLast = i === nodes.length - 1;
      const connector = isLast ? '└── ' : '├── ';

      if (node.type === 'directory') {
        lines.push(`${prefix}${connector}${node.name}/`);
        if (node.children && lines.length < maxLines) {
          const childPrefix = prefix + (isLast ? '    ' : '│   ');
          this.formatNode(node.children, childPrefix, lines, maxLines);
        }
      } else {
        lines.push(`${prefix}${connector}${node.name}`);
      }
    }
  }
}
