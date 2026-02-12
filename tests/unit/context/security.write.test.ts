import { describe, it, expect } from 'bun:test';
import { isProtectedPath, isUnsafeWritePath, getProtectedWritePatterns } from '../../../src/context/security.js';

describe('security write protection', () => {
  describe('isProtectedPath', () => {
    it('should block .git directory', () => {
      expect(isProtectedPath('.git')).toBe(true);
      expect(isProtectedPath('.git/config')).toBe(true);
      expect(isProtectedPath('.git/hooks/pre-commit')).toBe(true);
    });

    it('should block node_modules', () => {
      expect(isProtectedPath('node_modules')).toBe(true);
      expect(isProtectedPath('node_modules/lodash/index.js')).toBe(true);
      expect(isProtectedPath('node_modules/@types/node/index.d.ts')).toBe(true);
    });

    it('should block build directories', () => {
      expect(isProtectedPath('dist')).toBe(true);
      expect(isProtectedPath('dist/index.js')).toBe(true);
      expect(isProtectedPath('build')).toBe(true);
      expect(isProtectedPath('build/bundle.js')).toBe(true);
    });

    it('should block lock files', () => {
      expect(isProtectedPath('package-lock.json')).toBe(true);
      expect(isProtectedPath('yarn.lock')).toBe(true);
      expect(isProtectedPath('pnpm-lock.yaml')).toBe(true);
      expect(isProtectedPath('bun.lock')).toBe(true);
      expect(isProtectedPath('bun.lockb')).toBe(true);
    });

    it('should block IDE config directories', () => {
      expect(isProtectedPath('.idea')).toBe(true);
      expect(isProtectedPath('.idea/workspace.xml')).toBe(true);
      expect(isProtectedPath('.vscode')).toBe(true);
      expect(isProtectedPath('.vscode/settings.json')).toBe(true);
    });

    it('should allow source files', () => {
      expect(isProtectedPath('src/index.ts')).toBe(false);
      expect(isProtectedPath('lib/utils.js')).toBe(false);
      expect(isProtectedPath('package.json')).toBe(false);
      expect(isProtectedPath('README.md')).toBe(false);
    });

    it('should allow config files that are not protected', () => {
      expect(isProtectedPath('tsconfig.json')).toBe(false);
      expect(isProtectedPath('.eslintrc.json')).toBe(false);
      expect(isProtectedPath('.prettierrc')).toBe(false);
    });
  });

  describe('isUnsafeWritePath', () => {
    it('should block sensitive files', () => {
      expect(isUnsafeWritePath('.env')).toBe(true);
      expect(isUnsafeWritePath('credentials.json')).toBe(true);
      expect(isUnsafeWritePath('private.key')).toBe(true);
    });

    it('should block protected paths', () => {
      expect(isUnsafeWritePath('node_modules/test.js')).toBe(true);
      expect(isUnsafeWritePath('.git/config')).toBe(true);
      expect(isUnsafeWritePath('package-lock.json')).toBe(true);
    });

    it('should allow regular source files', () => {
      expect(isUnsafeWritePath('src/index.ts')).toBe(false);
      expect(isUnsafeWritePath('tests/test.spec.ts')).toBe(false);
      expect(isUnsafeWritePath('package.json')).toBe(false);
    });
  });

  describe('getProtectedWritePatterns', () => {
    it('should return an array of patterns', () => {
      const patterns = getProtectedWritePatterns();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should include common protected patterns', () => {
      const patterns = getProtectedWritePatterns();
      expect(patterns).toContain('.git');
      expect(patterns).toContain('node_modules');
      expect(patterns).toContain('package-lock.json');
    });
  });
});
