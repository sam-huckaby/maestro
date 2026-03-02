import type { FileNode } from './types.js';
import type { FileContext } from './FileContext.js';
import type { LLMProvider, Message, ContentBlock, ToolResultContent } from '../llm/types.js';
import type { ToolDefinition } from '../tools/types.js';
import { logger } from '../cli/ui/index.js';

export interface ProjectProfile {
  buildCommand: string;
  testCommand: string;
  languages: string[];
  bundler: string | null;
  packageManager: string | null;
  framework: string | null;
  monorepo: boolean;
  notes: string;
}

type ValidationResult = { profile: ProjectProfile } | { errors: string[] };

const MAX_PROFILE_TURNS = 8;

const READ_FILE_TOOL: ToolDefinition = {
  name: 'read_file',
  description:
    'Read the contents of a file. Use this to examine configuration files, package manifests, build configs, etc.',
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
};

function formatRootListing(tree: FileNode[]): string {
  return tree.map((node) => (node.type === 'directory' ? `${node.name}/` : node.name)).join('\n');
}

function buildProfileSystemPrompt(): string {
  return [
    'You are a project analysis agent. Your job is to identify the type, tooling, and build configuration of a software project.',
    '',
    'You will be given a listing of the root directory. Use the read_file tool to open any configuration files you need to inspect (package.json, tsconfig.json, Cargo.toml, Makefile, etc.).',
    '',
    'After inspecting the project, respond with ONLY a JSON object matching this exact schema:',
    '',
    '{',
    '  "buildCommand": "the exact shell command to build this project (e.g. npm run build, cargo build)",',
    '  "testCommand": "the exact shell command to run tests (e.g. npm test, cargo test)",',
    '  "languages": ["list", "of", "languages"],',
    '  "bundler": "bundler name or null (e.g. vite, webpack, esbuild, turbopack, rollup)",',
    '  "packageManager": "package manager or null (e.g. npm, pnpm, yarn, bun, cargo)",',
    '  "framework": "framework or null (e.g. next.js, remix, express, actix-web)",',
    '  "monorepo": false,',
    '  "notes": "any important devops details (e.g. workspace config, custom build steps, required env vars)"',
    '}',
    '',
    'Rules:',
    '- Read files before guessing. Inspect package.json scripts, lock files, build configs.',
    '- For buildCommand, use the actual script name from package.json if applicable (e.g. "npm run build" not "tsc").',
    '- Detect the package manager from lock files: package-lock.json=npm, yarn.lock=yarn, pnpm-lock.yaml=pnpm, bun.lockb=bun.',
    '- For monorepos, check for workspaces config in package.json, pnpm-workspace.yaml, or lerna.json.',
    '- If there is no build command, set buildCommand to "echo no build configured".',
    '- If there is no test command, set testCommand to "echo no tests configured".',
    '- Return ONLY the raw JSON object. No markdown fences, no explanation, no extra text.',
  ].join('\n');
}

function buildProfileUserPrompt(rootListing: string): string {
  return [
    'Here are the files and directories at the root of the project:',
    '',
    rootListing,
    '',
    'Inspect the relevant configuration files and return the project profile JSON.',
  ].join('\n');
}

function extractToolUses(
  content: ContentBlock[]
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return content
    .filter(
      (block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use'
    )
    .map((block) => ({ id: block.id, name: block.name, input: block.input }));
}

function extractTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;

  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

async function handleReadFileTool(
  fileContext: FileContext,
  toolId: string,
  input: Record<string, unknown>
): Promise<ToolResultContent> {
  const filePath = input.path as string;
  if (!filePath) {
    return {
      type: 'tool_result',
      tool_use_id: toolId,
      content: 'Error: path is required',
      is_error: true,
    };
  }

  try {
    const result = await fileContext.readFile(filePath);
    return { type: 'tool_result', tool_use_id: toolId, content: result.content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      type: 'tool_result',
      tool_use_id: toolId,
      content: `Error: ${message}`,
      is_error: true,
    };
  }
}

function collectProfileErrors(obj: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (typeof obj.buildCommand !== 'string' || obj.buildCommand === '')
    errors.push('buildCommand must be a non-empty string');
  if (typeof obj.testCommand !== 'string' || obj.testCommand === '')
    errors.push('testCommand must be a non-empty string');
  if (!Array.isArray(obj.languages) || obj.languages.length === 0)
    errors.push('languages must be a non-empty array of strings');
  if (typeof obj.monorepo !== 'boolean') errors.push('monorepo must be a boolean');
  return errors;
}

function validateProfileResponse(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      errors: [
        'Response is not valid JSON. Return ONLY a raw JSON object with no markdown fences or extra text.',
      ],
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { errors: ['Response is not a JSON object.'] };
  }

  const obj = parsed as Record<string, unknown>;
  const errors = collectProfileErrors(obj);
  if (errors.length > 0) return { errors };

  return {
    profile: {
      buildCommand: obj.buildCommand as string,
      testCommand: obj.testCommand as string,
      languages: obj.languages as string[],
      bundler: typeof obj.bundler === 'string' ? obj.bundler : null,
      packageManager: typeof obj.packageManager === 'string' ? obj.packageManager : null,
      framework: typeof obj.framework === 'string' ? obj.framework : null,
      monorepo: obj.monorepo as boolean,
      notes: typeof obj.notes === 'string' ? obj.notes : '',
    },
  };
}

function buildRetryPrompt(errors: string[]): string {
  return [
    'Your previous response could not be parsed.',
    `Issues: ${errors.join('; ')}.`,
    'Return ONLY a raw JSON object matching the schema. No markdown fences, no explanation, no extra text.',
  ].join(' ');
}

function toContentBlocks(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

export async function profileProject(
  llmProvider: LLMProvider,
  fileContext: FileContext,
  isJson: boolean
): Promise<ProjectProfile> {
  const tree = await fileContext.getFileTree();
  const rootListing = formatRootListing(tree);

  const messages: Message[] = [{ role: 'user', content: buildProfileUserPrompt(rootListing) }];

  let turnsRemaining = MAX_PROFILE_TURNS;

  while (turnsRemaining > 0) {
    turnsRemaining--;

    const response = await llmProvider.complete({
      system: buildProfileSystemPrompt(),
      messages,
      tools: [READ_FILE_TOOL],
      maxTokens: 4096,
      temperature: 0,
    });

    if (response.stopReason !== 'tool_use') {
      const text = extractTextContent(response.content);
      const result = validateProfileResponse(text);

      if ('profile' in result) return result.profile;

      if (!isJson) {
        logger.debug(`Profile validation failed: ${result.errors.join('; ')}`);
      }

      messages.push({ role: 'assistant', content: toContentBlocks(response.content) });
      messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
      continue;
    }

    const contentBlocks = response.content as ContentBlock[];
    const toolUses = extractToolUses(contentBlocks);

    if (toolUses.length === 0) {
      const text = extractTextContent(response.content);
      const result = validateProfileResponse(text);

      if ('profile' in result) return result.profile;

      if (!isJson) {
        logger.debug(`Profile validation failed: ${result.errors.join('; ')}`);
      }

      messages.push({ role: 'assistant', content: contentBlocks });
      messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
      continue;
    }

    const toolResults: ToolResultContent[] = [];

    for (const toolUse of toolUses) {
      if (!isJson) {
        logger.agent('profiler', `Reading ${toolUse.input.path}`);
      }
      const result = await handleReadFileTool(fileContext, toolUse.id, toolUse.input);
      toolResults.push(result);
    }

    messages.push({ role: 'assistant', content: contentBlocks });
    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Project profiler exceeded maximum turns without returning a valid profile');
}
