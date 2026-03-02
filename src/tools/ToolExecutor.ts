import { spawn } from 'child_process';
import type { FileContext } from '../context/FileContext.js';
import type { ToolUse, ToolResult } from './types.js';
import { isSensitiveFile, isUnsafeWritePath, isAllowedCommand } from '../context/security.js';
import { isTokfAvailable, wrapWithTokf } from '../utils/tokf.js';

export type FileWriteCallback = (path: string, action: 'created' | 'updated' | 'edited') => void;

export class ToolExecutor {
  private workingDirectory: string;

  constructor(
    private fileContext: FileContext,
    private allowWrites: boolean = false,
    private onFileWrite?: FileWriteCallback,
    private allowCommands: boolean = false,
    workingDirectory?: string
  ) {
    this.workingDirectory = workingDirectory ?? process.cwd();
  }

  async execute(toolUse: ToolUse): Promise<ToolResult> {
    switch (toolUse.name) {
      case 'read_file':
        return this.handleReadFile(toolUse);
      case 'find_files':
        return this.handleFindFiles(toolUse);
      case 'write_file':
        return this.handleWriteFile(toolUse);
      case 'edit_file':
        return this.handleEditFile(toolUse);
      case 'restore_file':
        return this.handleRestoreFile(toolUse);
      case 'run_command':
        return this.handleRunCommand(toolUse);
      default:
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Unknown tool: ${toolUse.name}`,
          is_error: true,
        };
    }
  }

  private async handleReadFile(toolUse: ToolUse): Promise<ToolResult> {
    const path = toolUse.input.path as string;

    if (!path) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: path parameter is required',
        is_error: true,
      };
    }

    // SECURITY: Block access to sensitive files
    if (isSensitiveFile(path)) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Access denied: "${path}" is a sensitive file and cannot be read for security reasons.`,
        is_error: true,
      };
    }

    try {
      const result = await this.fileContext.readFile(path);
      let content = result.content;

      if (result.truncated) {
        content += `\n\n[File truncated - showing first ${content.length} bytes of ${result.size} total bytes]`;
      }

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content,
      };
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }

  private async handleFindFiles(toolUse: ToolUse): Promise<ToolResult> {
    const pattern = toolUse.input.pattern as string;

    if (!pattern) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: pattern parameter is required',
        is_error: true,
      };
    }

    try {
      const files = await this.fileContext.findFiles(pattern);

      if (files.length === 0) {
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `No files found matching pattern: ${pattern}`,
        };
      }

      // Limit to 100 files to avoid overwhelming output
      const maxFiles = 100;
      const truncated = files.length > maxFiles;
      const displayFiles = truncated ? files.slice(0, maxFiles) : files;

      let content = displayFiles.join('\n');
      if (truncated) {
        content += `\n\n[... and ${files.length - maxFiles} more files]`;
      }

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content,
      };
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Error finding files: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }

  private async handleWriteFile(toolUse: ToolUse): Promise<ToolResult> {
    // Check if writes are allowed for this agent
    if (!this.allowWrites) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: This agent does not have write permissions.',
        is_error: true,
      };
    }

    const path = toolUse.input.path as string;
    const content = toolUse.input.content as string;
    const overwrite = toolUse.input.overwrite as boolean | undefined;

    if (!path) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: path parameter is required',
        is_error: true,
      };
    }

    if (content === undefined || content === null) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: content parameter is required',
        is_error: true,
      };
    }

    // SECURITY: Block writes to sensitive/protected files
    if (isUnsafeWritePath(path)) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Access denied: "${path}" is in a protected location and cannot be written.`,
        is_error: true,
      };
    }

    try {
      const result = await this.fileContext.writeFile(path, content, { overwrite });

      const action = result.created ? 'Created' : 'Updated';
      const backupNote = result.backedUp ? ' (backup created)' : '';

      this.onFileWrite?.(path, result.created ? 'created' : 'updated');

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `${action} ${path}${backupNote}\nBytes written: ${result.bytesWritten}`,
      };
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }

  private async handleEditFile(toolUse: ToolUse): Promise<ToolResult> {
    // Check if writes are allowed for this agent
    if (!this.allowWrites) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: This agent does not have write permissions.',
        is_error: true,
      };
    }

    const path = toolUse.input.path as string;
    const oldContent = toolUse.input.old_content as string;
    const newContent = toolUse.input.new_content as string;

    if (!path) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: path parameter is required',
        is_error: true,
      };
    }

    if (!oldContent) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: old_content parameter is required',
        is_error: true,
      };
    }

    if (newContent === undefined || newContent === null) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: new_content parameter is required',
        is_error: true,
      };
    }

    // SECURITY: Block writes to sensitive/protected files
    if (isUnsafeWritePath(path)) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Access denied: "${path}" is in a protected location and cannot be edited.`,
        is_error: true,
      };
    }

    try {
      const result = await this.fileContext.editFile(path, oldContent, newContent);

      this.onFileWrite?.(path, 'edited');

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Edited ${path}\nReplacements made: ${result.replacements}\nBytes written: ${result.bytesWritten}`,
      };
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Error editing file: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }

  private async handleRestoreFile(toolUse: ToolUse): Promise<ToolResult> {
    // Check if writes are allowed for this agent
    if (!this.allowWrites) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: This agent does not have write permissions.',
        is_error: true,
      };
    }

    const path = toolUse.input.path as string;

    if (!path) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: path parameter is required',
        is_error: true,
      };
    }

    try {
      const restored = await this.fileContext.restoreFile(path);

      if (restored) {
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Restored ${path} from backup`,
        };
      } else {
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `No backup found for ${path}`,
          is_error: true,
        };
      }
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Error restoring file: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }

  private async handleRunCommand(toolUse: ToolUse): Promise<ToolResult> {
    // Check if command execution is allowed for this agent
    if (!this.allowCommands) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: This agent does not have command execution permissions.',
        is_error: true,
      };
    }

    const command = toolUse.input.command as string;
    const timeoutMs = Math.min(
      (toolUse.input.timeout_ms as number) || 60000,
      300000 // Max 5 minutes
    );

    if (!command) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: command parameter is required',
        is_error: true,
      };
    }

    // SECURITY: Check if command is allowed
    const commandCheck = isAllowedCommand(command);
    if (!commandCheck.allowed) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Command blocked: ${commandCheck.reason}`,
        is_error: true,
      };
    }

    // Wrap with tokf when available to compress build output for the LLM context
    const finalCommand = isTokfAvailable() ? wrapWithTokf(command) : command;

    try {
      const result = await this.executeCommand(finalCommand, timeoutMs);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.output,
        is_error: result.exitCode !== 0,
      };
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Error executing command: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }

  private executeCommand(
    command: string,
    timeoutMs: number
  ): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const workingDir = this.workingDirectory;
      const child = spawn('sh', ['-c', command], {
        cwd: workingDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        const exitCode = code ?? 1;
        let output = '';

        if (stdout.trim()) {
          output += `STDOUT:\n${stdout.trim()}`;
        }
        if (stderr.trim()) {
          if (output) output += '\n\n';
          output += `STDERR:\n${stderr.trim()}`;
        }
        if (!output) {
          output =
            exitCode === 0
              ? 'Command completed successfully (no output)'
              : 'Command failed (no output)';
        }

        output += `\n\nExit code: ${exitCode}`;

        resolve({ output, exitCode });
      });
    });
  }
}
