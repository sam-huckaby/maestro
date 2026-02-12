import { describe, it, expect } from 'bun:test';
import { createIgnoreFilter, getDefaultIgnores } from '../../../src/context/ignore.js';

describe('ignore', () => {
  describe('getDefaultIgnores', () => {
    it('should return an array of default ignore patterns', () => {
      const patterns = getDefaultIgnores();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should include common ignore patterns', () => {
      const patterns = getDefaultIgnores();
      expect(patterns).toContain('node_modules');
      expect(patterns).toContain('.git');
      expect(patterns).toContain('dist');
      expect(patterns).toContain('.DS_Store');
    });
  });

  describe('createIgnoreFilter', () => {
    it('should ignore node_modules', () => {
      const filter = createIgnoreFilter('/tmp/test-project');
      expect(filter('node_modules')).toBe(true);
      expect(filter('node_modules/lodash/index.js')).toBe(true);
    });

    it('should ignore .git', () => {
      const filter = createIgnoreFilter('/tmp/test-project');
      expect(filter('.git')).toBe(true);
      expect(filter('.git/config')).toBe(true);
    });

    it('should ignore dist and build directories', () => {
      const filter = createIgnoreFilter('/tmp/test-project');
      expect(filter('dist')).toBe(true);
      expect(filter('build')).toBe(true);
      expect(filter('dist/index.js')).toBe(true);
    });

    it('should not ignore source files', () => {
      const filter = createIgnoreFilter('/tmp/test-project');
      expect(filter('src/index.ts')).toBe(false);
      expect(filter('lib/utils.ts')).toBe(false);
      expect(filter('package.json')).toBe(false);
    });

    it('should accept additional patterns', () => {
      const filter = createIgnoreFilter('/tmp/test-project', ['*.custom', 'extra/']);
      expect(filter('file.custom')).toBe(true);
      expect(filter('extra/something.ts')).toBe(true);
      expect(filter('normal.ts')).toBe(false);
    });
  });
});
