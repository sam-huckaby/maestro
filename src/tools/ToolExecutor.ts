import type { FileContext } from '../context/FileContext.js';
import type { ToolUse, ToolResult } from './types.js';
import { isSensitiveFile, isUnsafeWritePath } from '../context/security.js';

export class ToolExecutor {
  constructor(
    private fileContext: FileContext,
    private allowWrites: boolean = false
  ) {}

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
}
