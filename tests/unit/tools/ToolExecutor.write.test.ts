import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolExecutor } from '../../../src/tools/ToolExecutor.js';
import { FileContext } from '../../../src/context/FileContext.js';
import type { ToolUse } from '../../../src/tools/types.js';

const TEST_DIR = join(process.cwd(), 'test-tools-write-temp');

describe('ToolExecutor write operations', () => {
  let fileContext: FileContext;
  let executorWithWrites: ToolExecutor;
  let executorReadOnly: ToolExecutor;

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Reset test files
    writeFileSync(join(TEST_DIR, 'existing.txt'), 'original content');
    writeFileSync(join(TEST_DIR, 'src', 'index.ts'), 'export const x = 1;');

    // Remove new files
    try {
      rmSync(join(TEST_DIR, 'new.txt'), { force: true });
    } catch {
      // Ignore
    }

    fileContext = new FileContext({ workingDirectory: TEST_DIR });
    executorWithWrites = new ToolExecutor(fileContext, true);
    executorReadOnly = new ToolExecutor(fileContext, false);
  });

  describe('write_file tool', () => {
    it('should create a new file when allowed', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-1',
        name: 'write_file',
        input: { path: 'new.txt', content: 'hello world' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain('Created');
      expect(result.content).toContain('new.txt');
    });

    it('should block writes when not allowed', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-2',
        name: 'write_file',
        input: { path: 'new.txt', content: 'hello' },
      };

      const result = await executorReadOnly.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('does not have write permissions');
    });

    it('should require path parameter', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-3',
        name: 'write_file',
        input: { content: 'hello' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('path parameter is required');
    });

    it('should require content parameter', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-4',
        name: 'write_file',
        input: { path: 'new.txt' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('content parameter is required');
    });

    it('should block writes to protected paths', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-5',
        name: 'write_file',
        input: { path: 'node_modules/test.js', content: 'bad' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('protected location');
    });

    it('should block writes to .env files', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-6',
        name: 'write_file',
        input: { path: '.env', content: 'SECRET=bad' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('protected location');
    });

    it('should require read before overwrite by default', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-7',
        name: 'write_file',
        input: { path: 'existing.txt', content: 'new content' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Must read file before overwriting');
    });

    it('should allow overwrite with explicit flag', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-8',
        name: 'write_file',
        input: { path: 'existing.txt', content: 'forced', overwrite: true },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain('Updated');
      expect(result.content).toContain('backup created');
    });
  });

  describe('edit_file tool', () => {
    it('should perform edits when allowed', async () => {
      // First read the file
      await executorWithWrites.execute({
        type: 'tool_use',
        id: 'read-1',
        name: 'read_file',
        input: { path: 'src/index.ts' },
      });

      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-9',
        name: 'edit_file',
        input: {
          path: 'src/index.ts',
          old_content: 'const x = 1',
          new_content: 'const x = 42',
        },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain('Edited');
      expect(result.content).toContain('Replacements made: 1');
    });

    it('should block edits when not allowed', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-10',
        name: 'edit_file',
        input: {
          path: 'existing.txt',
          old_content: 'original',
          new_content: 'modified',
        },
      };

      const result = await executorReadOnly.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('does not have write permissions');
    });

    it('should require path parameter', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-11',
        name: 'edit_file',
        input: { old_content: 'old', new_content: 'new' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('path parameter is required');
    });

    it('should require old_content parameter', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-12',
        name: 'edit_file',
        input: { path: 'file.txt', new_content: 'new' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('old_content parameter is required');
    });

    it('should require new_content parameter', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-13',
        name: 'edit_file',
        input: { path: 'file.txt', old_content: 'old' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('new_content parameter is required');
    });

    it('should require read before edit', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-14',
        name: 'edit_file',
        input: {
          path: 'existing.txt',
          old_content: 'original',
          new_content: 'modified',
        },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Must read file before editing');
    });
  });

  describe('restore_file tool', () => {
    it('should restore from backup', async () => {
      // Read, write, then restore
      await executorWithWrites.execute({
        type: 'tool_use',
        id: 'read-2',
        name: 'read_file',
        input: { path: 'existing.txt' },
      });

      await executorWithWrites.execute({
        type: 'tool_use',
        id: 'write-1',
        name: 'write_file',
        input: { path: 'existing.txt', content: 'modified' },
      });

      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-15',
        name: 'restore_file',
        input: { path: 'existing.txt' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain('Restored');

      // Verify content restored
      const content = readFileSync(join(TEST_DIR, 'existing.txt'), 'utf-8');
      expect(content).toBe('original content');
    });

    it('should return error if no backup exists', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-16',
        name: 'restore_file',
        input: { path: 'existing.txt' },
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('No backup found');
    });

    it('should block restore when not allowed', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-17',
        name: 'restore_file',
        input: { path: 'existing.txt' },
      };

      const result = await executorReadOnly.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('does not have write permissions');
    });

    it('should require path parameter', async () => {
      const toolUse: ToolUse = {
        type: 'tool_use',
        id: 'test-18',
        name: 'restore_file',
        input: {},
      };

      const result = await executorWithWrites.execute(toolUse);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('path parameter is required');
    });
  });
});
