import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ToolExecutor } from '../../../src/tools/ToolExecutor.js';
import { FileContext } from '../../../src/context/FileContext.js';
import type { ToolUse } from '../../../src/tools/types.js';

const TEST_DIR = join(process.cwd(), 'test-tools-temp');

describe('ToolExecutor', () => {
  let fileContext: FileContext;
  let executor: ToolExecutor;

  beforeAll(() => {
    // Create a test directory structure
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src'), { recursive: true });

    // Create test files
    writeFileSync(join(TEST_DIR, 'package.json'), '{"name": "test"}');
    writeFileSync(join(TEST_DIR, 'src', 'index.ts'), 'export const hello = "world";');
    writeFileSync(join(TEST_DIR, '.env'), 'SECRET=supersecret');
    writeFileSync(join(TEST_DIR, 'credentials.json'), '{"api_key": "secret"}');

    fileContext = new FileContext({ workingDirectory: TEST_DIR });
    executor = new ToolExecutor(fileContext);
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('read_file tool', () => {
    it('should read file contents', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-1',
        name: 'read_file',
        input: { path: 'package.json' },
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBeUndefined();
      expect(result.content).toBe('{"name": "test"}');
      expect(result.tool_use_id).toBe('test-1');
    });

    it('should block reading .env files', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-2',
        name: 'read_file',
        input: { path: '.env' },
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Access denied');
      expect(result.content).toContain('sensitive file');
    });

    it('should block reading credential files', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-3',
        name: 'read_file',
        input: { path: 'credentials.json' },
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Access denied');
    });

    it('should return error for non-existent files', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-4',
        name: 'read_file',
        input: { path: 'nonexistent.txt' },
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Error reading file');
    });

    it('should require path parameter', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-5',
        name: 'read_file',
        input: {},
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('path parameter is required');
    });
  });

  describe('find_files tool', () => {
    it('should find files matching pattern', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-6',
        name: 'find_files',
        input: { pattern: '**/*.ts' },
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain('src/index.ts');
    });

    it('should handle no matches', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-7',
        name: 'find_files',
        input: { pattern: '**/*.py' },
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain('No files found');
    });

    it('should require pattern parameter', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-8',
        name: 'find_files',
        input: {},
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('pattern parameter is required');
    });
  });

  describe('unknown tool', () => {
    it('should return error for unknown tool', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-9',
        name: 'unknown_tool',
        input: {},
      };

      const result = await executor.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Unknown tool');
    });
  });
});
