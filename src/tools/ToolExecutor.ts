import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileContext } from '../context/FileContext.js';
import type { ToolUse, ToolResult } from './types.js';
import { isSensitiveFile, isUnsafeWritePath, isAllowedCommand } from '../context/security.js';

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
      case 'detect_project_type':
        return this.handleDetectProjectType(toolUse);
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

    try {
      const result = await this.executeCommand(command, timeoutMs);
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
          output = exitCode === 0 ? 'Command completed successfully (no output)' : 'Command failed (no output)';
        }

        output += `\n\nExit code: ${exitCode}`;

        resolve({ output, exitCode });
      });
    });
  }

  private async handleDetectProjectType(toolUse: ToolUse): Promise<ToolResult> {
    // Check if command execution is allowed for this agent
    if (!this.allowCommands) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: This agent does not have command execution permissions.',
        is_error: true,
      };
    }

    try {
      const rootPath = this.workingDirectory;
      const projectInfo = await this.analyzeProject(rootPath);

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(projectInfo, null, 2),
      };
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Error detecting project type: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }

  private async analyzeProject(rootPath: string): Promise<ProjectInfo> {
    const info: ProjectInfo = {
      types: [],
      buildSystems: [],
      availableCommands: [],
      configFiles: [],
    };

    // Check for various config files
    const checks = [
      { file: 'package.json', type: 'node', buildSystem: 'npm' },
      { file: 'bun.lockb', type: 'node', buildSystem: 'bun' },
      { file: 'yarn.lock', type: 'node', buildSystem: 'yarn' },
      { file: 'pnpm-lock.yaml', type: 'node', buildSystem: 'pnpm' },
      { file: 'Cargo.toml', type: 'rust', buildSystem: 'cargo' },
      { file: 'go.mod', type: 'go', buildSystem: 'go' },
      { file: 'Makefile', type: 'make', buildSystem: 'make' },
      { file: 'CMakeLists.txt', type: 'cmake', buildSystem: 'cmake' },
      { file: 'pyproject.toml', type: 'python', buildSystem: 'poetry' },
      { file: 'setup.py', type: 'python', buildSystem: 'pip' },
      { file: 'requirements.txt', type: 'python', buildSystem: 'pip' },
      { file: 'build.gradle', type: 'java', buildSystem: 'gradle' },
      { file: 'build.gradle.kts', type: 'kotlin', buildSystem: 'gradle' },
      { file: 'pom.xml', type: 'java', buildSystem: 'maven' },
      { file: 'Gemfile', type: 'ruby', buildSystem: 'bundler' },
      { file: 'composer.json', type: 'php', buildSystem: 'composer' },
      { file: 'mix.exs', type: 'elixir', buildSystem: 'mix' },
      { file: 'deno.json', type: 'deno', buildSystem: 'deno' },
      { file: 'deno.jsonc', type: 'deno', buildSystem: 'deno' },
    ];

    for (const check of checks) {
      try {
        await fs.access(path.join(rootPath, check.file));
        info.configFiles.push(check.file);
        if (!info.types.includes(check.type)) {
          info.types.push(check.type);
        }
        if (!info.buildSystems.includes(check.buildSystem)) {
          info.buildSystems.push(check.buildSystem);
        }
      } catch {
        // File doesn't exist
      }
    }

    // Parse package.json for npm scripts
    if (info.configFiles.includes('package.json')) {
      try {
        const pkgPath = path.join(rootPath, 'package.json');
        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgContent);

        if (pkg.scripts) {
          for (const scriptName of Object.keys(pkg.scripts)) {
            // Determine the package manager
            let runner = 'npm run';
            if (info.buildSystems.includes('bun')) runner = 'bun run';
            else if (info.buildSystems.includes('yarn')) runner = 'yarn';
            else if (info.buildSystems.includes('pnpm')) runner = 'pnpm run';

            info.availableCommands.push({
              name: scriptName,
              command: `${runner} ${scriptName}`,
              description: pkg.scripts[scriptName],
            });
          }
        }
      } catch {
        // Failed to parse package.json
      }
    }

    // Add standard commands for detected build systems
    if (info.buildSystems.includes('cargo')) {
      info.availableCommands.push(
        { name: 'build', command: 'cargo build', description: 'Build the Rust project' },
        { name: 'test', command: 'cargo test', description: 'Run Rust tests' },
        { name: 'check', command: 'cargo check', description: 'Check for errors' }
      );
    }

    if (info.buildSystems.includes('go')) {
      info.availableCommands.push(
        { name: 'build', command: 'go build ./...', description: 'Build Go packages' },
        { name: 'test', command: 'go test ./...', description: 'Run Go tests' }
      );
    }

    if (info.buildSystems.includes('make')) {
      info.availableCommands.push(
        { name: 'make', command: 'make', description: 'Run default make target' }
      );
    }

    return info;
  }
}

interface ProjectInfo {
  types: string[];
  buildSystems: string[];
  availableCommands: Array<{
    name: string;
    command: string;
    description: string;
  }>;
  configFiles: string[];
}
