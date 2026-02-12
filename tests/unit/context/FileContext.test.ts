import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FileContext } from '../../../src/context/FileContext.js';

const TEST_DIR = join(process.cwd(), 'test-project-temp');

describe('FileContext', () => {
  beforeAll(() => {
    // Create a test directory structure
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src', 'utils'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'tests'), { recursive: true });

    // Create test files
    writeFileSync(join(TEST_DIR, 'package.json'), '{"name": "test"}');
    writeFileSync(join(TEST_DIR, 'src', 'index.ts'), 'export const hello = "world";');
    writeFileSync(join(TEST_DIR, 'src', 'utils', 'helper.ts'), 'export function help() {}');
    writeFileSync(join(TEST_DIR, 'tests', 'index.test.ts'), 'test("works", () => {});');
    writeFileSync(join(TEST_DIR, '.env'), 'SECRET=supersecret');
  });

  afterAll(() => {
    // Clean up
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('getFileTree', () => {
    it('should return the file tree', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const tree = await context.getFileTree();

      expect(Array.isArray(tree)).toBe(true);
      expect(tree.length).toBeGreaterThan(0);
    });

    it('should not include sensitive files in tree', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const tree = await context.getFileTree();

      // Flatten tree to check for .env
      const allPaths: string[] = [];
      const collectPaths = (nodes: typeof tree): void => {
        for (const node of nodes) {
          allPaths.push(node.path);
          if (node.children) collectPaths(node.children);
        }
      };
      collectPaths(tree);

      expect(allPaths).not.toContain('.env');
    });
  });

  describe('readFile', () => {
    it('should read file contents', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const result = await context.readFile('package.json');

      expect(result.content).toBe('{"name": "test"}');
      expect(result.truncated).toBe(false);
    });

    it('should track read files', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      await context.readFile('package.json');

      expect(context.hasRead('package.json')).toBe(true);
      expect(context.getFilesRead()).toContain('package.json');
    });

    it('should throw for non-existent files', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await expect(context.readFile('nonexistent.txt')).rejects.toThrow('File not found');
    });

    it('should throw for directories', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await expect(context.readFile('src')).rejects.toThrow('Cannot read directory');
    });
  });

  describe('findFiles', () => {
    it('should find TypeScript files', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const files = await context.findFiles('**/*.ts');

      expect(files.length).toBe(3);
      expect(files).toContain('src/index.ts');
      expect(files).toContain('src/utils/helper.ts');
      expect(files).toContain('tests/index.test.ts');
    });

    it('should find files in specific directory', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const files = await context.findFiles('src/**/*.ts');

      expect(files.length).toBe(2);
      expect(files).toContain('src/index.ts');
      expect(files).toContain('src/utils/helper.ts');
    });

    it('should return empty array for no matches', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const files = await context.findFiles('**/*.py');

      expect(files).toEqual([]);
    });
  });

  describe('formatTreeForPrompt', () => {
    it('should return formatted tree string', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const formatted = context.formatTreeForPrompt();

      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted).toContain('src/');
      expect(formatted).toContain('package.json');
    });

    it('should respect max lines limit', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const formatted = context.formatTreeForPrompt(3);

      const lines = formatted.split('\n');
      expect(lines.length).toBeLessThanOrEqual(4); // 3 + truncated message
    });
  });
});
