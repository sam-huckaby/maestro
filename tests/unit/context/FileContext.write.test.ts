import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FileContext } from '../../../src/context/FileContext.js';

const TEST_DIR = join(process.cwd(), 'test-write-temp');

describe('FileContext write operations', () => {
  beforeAll(() => {
    // Create a test directory structure
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  });

  afterAll(() => {
    // Clean up
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Reset test files before each test
    writeFileSync(join(TEST_DIR, 'existing.txt'), 'original content');
    writeFileSync(join(TEST_DIR, 'src', 'index.ts'), 'export const x = 1;');

    // Remove any new files created by tests
    try {
      rmSync(join(TEST_DIR, 'new.txt'), { force: true });
      rmSync(join(TEST_DIR, 'new-dir'), { recursive: true, force: true });
    } catch {
      // Ignore if files don't exist
    }
  });

  describe('writeFile', () => {
    it('should create a new file', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const result = await context.writeFile('new.txt', 'hello world');

      expect(result.created).toBe(true);
      expect(result.backedUp).toBe(false);
      expect(result.bytesWritten).toBe(11);

      const content = readFileSync(join(TEST_DIR, 'new.txt'), 'utf-8');
      expect(content).toBe('hello world');
    });

    it('should create directories if needed', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const result = await context.writeFile('new-dir/nested/file.txt', 'nested content');

      expect(result.created).toBe(true);
      expect(existsSync(join(TEST_DIR, 'new-dir/nested/file.txt'))).toBe(true);
    });

    it('should require read before overwrite by default', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await expect(
        context.writeFile('existing.txt', 'new content')
      ).rejects.toThrow('Must read file before overwriting');
    });

    it('should allow overwrite after reading', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await context.readFile('existing.txt');
      const result = await context.writeFile('existing.txt', 'updated content');

      expect(result.created).toBe(false);
      expect(result.backedUp).toBe(true);

      const content = readFileSync(join(TEST_DIR, 'existing.txt'), 'utf-8');
      expect(content).toBe('updated content');
    });

    it('should allow overwrite with explicit flag', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      const result = await context.writeFile('existing.txt', 'forced content', { overwrite: true });

      expect(result.created).toBe(false);
      expect(result.backedUp).toBe(true);

      const content = readFileSync(join(TEST_DIR, 'existing.txt'), 'utf-8');
      expect(content).toBe('forced content');
    });

    it('should track written files', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      await context.writeFile('new.txt', 'content');

      expect(context.hasWritten('new.txt')).toBe(true);
      expect(context.getFilesWritten()).toContain('new.txt');
    });

    it('should block writes to protected paths', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await expect(
        context.writeFile('node_modules/test.js', 'bad')
      ).rejects.toThrow('Cannot write to protected path');
    });

    it('should block writes to sensitive files', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await expect(
        context.writeFile('.env', 'SECRET=bad')
      ).rejects.toThrow('Cannot write to protected path');
    });
  });

  describe('editFile', () => {
    it('should perform search/replace edits', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await context.readFile('src/index.ts');
      const result = await context.editFile('src/index.ts', 'const x = 1', 'const x = 42');

      expect(result.replacements).toBe(1);

      const content = readFileSync(join(TEST_DIR, 'src/index.ts'), 'utf-8');
      expect(content).toBe('export const x = 42;');
    });

    it('should require read before edit', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await expect(
        context.editFile('existing.txt', 'original', 'new')
      ).rejects.toThrow('Must read file before editing');
    });

    it('should throw if search content not found', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      await context.readFile('existing.txt');

      await expect(
        context.editFile('existing.txt', 'nonexistent text', 'replacement')
      ).rejects.toThrow('Search content not found');
    });

    it('should replace all occurrences', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      // Create file with multiple occurrences
      writeFileSync(join(TEST_DIR, 'multi.txt'), 'foo bar foo baz foo');
      await context.readFile('multi.txt');

      const result = await context.editFile('multi.txt', 'foo', 'qux');

      expect(result.replacements).toBe(3);

      const content = readFileSync(join(TEST_DIR, 'multi.txt'), 'utf-8');
      expect(content).toBe('qux bar qux baz qux');
    });

    it('should create backup before edit', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });
      await context.readFile('existing.txt');

      await context.editFile('existing.txt', 'original', 'modified');

      expect(context.hasBackup('existing.txt')).toBe(true);
    });

    it('should throw for non-existent files', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await expect(
        context.editFile('nonexistent.txt', 'old', 'new')
      ).rejects.toThrow('File not found');
    });
  });

  describe('restoreFile', () => {
    it('should restore from backup', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await context.readFile('existing.txt');
      await context.writeFile('existing.txt', 'modified content');

      // Verify modified
      expect(readFileSync(join(TEST_DIR, 'existing.txt'), 'utf-8')).toBe('modified content');

      // Restore
      const restored = await context.restoreFile('existing.txt');
      expect(restored).toBe(true);

      // Verify restored
      expect(readFileSync(join(TEST_DIR, 'existing.txt'), 'utf-8')).toBe('original content');
    });

    it('should return false if no backup exists', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      const restored = await context.restoreFile('existing.txt');
      expect(restored).toBe(false);
    });

    it('should remove backup after restore', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await context.readFile('existing.txt');
      await context.writeFile('existing.txt', 'modified');

      expect(context.hasBackup('existing.txt')).toBe(true);

      await context.restoreFile('existing.txt');

      expect(context.hasBackup('existing.txt')).toBe(false);
    });
  });

  describe('backup management', () => {
    it('should track backups', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await context.readFile('existing.txt');
      await context.writeFile('existing.txt', 'new content');

      expect(context.hasBackup('existing.txt')).toBe(true);
    });

    it('should clear all backups', async () => {
      const context = new FileContext({ workingDirectory: TEST_DIR });

      await context.readFile('existing.txt');
      await context.writeFile('existing.txt', 'new');

      expect(context.hasBackup('existing.txt')).toBe(true);

      context.clearBackups();

      expect(context.hasBackup('existing.txt')).toBe(false);
    });
  });
});
