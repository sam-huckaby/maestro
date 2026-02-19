export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface ToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// File reading tools available to agents
export const FILE_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read the contents of a file. Use this to examine source code, configuration, or any text file before making changes or to understand existing implementations.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file from the project root',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'find_files',
    description:
      'Find files matching a glob pattern. Use this to discover files in the project (e.g., "**/*.ts" for all TypeScript files, "src/**/*.test.js" for test files in src).',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.test.js")',
        },
      },
      required: ['pattern'],
    },
  },
];

// File writing tools available to agents with write permissions
export const FILE_WRITE_TOOLS: ToolDefinition[] = [
  {
    name: 'write_file',
    description:
      'Write content to a file. Creates the file if it does not exist. IMPORTANT: You MUST read the file first using read_file before overwriting an existing file, unless you set overwrite: true.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file from the project root',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
        overwrite: {
          type: 'boolean',
          description: 'If true, skip the read-before-write check. Use with caution.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Make targeted edits to a file using search and replace. You MUST read the file first using read_file. The old_content must exactly match text in the file. All occurrences will be replaced.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file from the project root',
        },
        old_content: {
          type: 'string',
          description: 'The exact content to find and replace',
        },
        new_content: {
          type: 'string',
          description: 'The content to replace it with',
        },
      },
      required: ['path', 'old_content', 'new_content'],
    },
  },
  {
    name: 'restore_file',
    description:
      'Restore a file from its backup. A backup is automatically created before each write or edit operation. Use this to undo a bad write.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file from the project root',
        },
      },
      required: ['path'],
    },
  },
];

// Command execution tools for DevOps agent
export const COMMAND_TOOLS: ToolDefinition[] = [
  {
    name: 'run_command',
    description:
      'Execute a shell command for build, test, or lint operations. Only allowed commands are permitted (npm, yarn, cargo, go, make, etc.). Dangerous commands like rm, sudo, curl, wget are blocked.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute (e.g., "npm run build", "cargo test")',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 60000, max: 300000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'detect_project_type',
    description:
      'Analyze the project to detect its type, build system, and available commands. Returns information about package.json, Cargo.toml, go.mod, Makefile, etc.',
    input_schema: {
      type: 'object',
      properties: {
        // No additional properties needed - analyzes current project
      },
      required: [],
    },
  },
];
