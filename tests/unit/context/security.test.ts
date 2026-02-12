import { describe, it, expect } from 'bun:test';
import { isSensitiveFile, getSensitivePatterns } from '../../../src/context/security.js';

describe('security', () => {
  describe('isSensitiveFile', () => {
    it('should block .env files', () => {
      expect(isSensitiveFile('.env')).toBe(true);
      expect(isSensitiveFile('.env.local')).toBe(true);
      expect(isSensitiveFile('.env.production')).toBe(true);
      expect(isSensitiveFile('.env.development')).toBe(true);
      expect(isSensitiveFile('.env.test')).toBe(true);
    });

    it('should block key files', () => {
      expect(isSensitiveFile('private.key')).toBe(true);
      expect(isSensitiveFile('server.pem')).toBe(true);
      expect(isSensitiveFile('cert.p12')).toBe(true);
      expect(isSensitiveFile('id_rsa')).toBe(true);
      expect(isSensitiveFile('id_ed25519')).toBe(true);
    });

    it('should block credential files', () => {
      expect(isSensitiveFile('credentials.json')).toBe(true);
      expect(isSensitiveFile('credentials.yaml')).toBe(true);
      expect(isSensitiveFile('secrets.json')).toBe(true);
      expect(isSensitiveFile('.npmrc')).toBe(true);
    });

    it('should block database files', () => {
      expect(isSensitiveFile('data.db')).toBe(true);
      expect(isSensitiveFile('local.sqlite')).toBe(true);
      expect(isSensitiveFile('app.sqlite3')).toBe(true);
    });

    it('should block files in secrets directories', () => {
      expect(isSensitiveFile('config/secrets/api.json')).toBe(true);
      expect(isSensitiveFile('secrets/tokens.txt')).toBe(true);
    });

    it('should allow regular source files', () => {
      expect(isSensitiveFile('index.ts')).toBe(false);
      expect(isSensitiveFile('src/utils/helper.ts')).toBe(false);
      expect(isSensitiveFile('package.json')).toBe(false);
      expect(isSensitiveFile('README.md')).toBe(false);
    });

    it('should allow config files that are not sensitive', () => {
      expect(isSensitiveFile('tsconfig.json')).toBe(false);
      expect(isSensitiveFile('jest.config.js')).toBe(false);
      expect(isSensitiveFile('.eslintrc.json')).toBe(false);
    });
  });

  describe('getSensitivePatterns', () => {
    it('should return an array of patterns', () => {
      const patterns = getSensitivePatterns();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should include common sensitive patterns', () => {
      const patterns = getSensitivePatterns();
      expect(patterns).toContain('.env');
      expect(patterns).toContain('*.pem');
      expect(patterns).toContain('*.key');
    });
  });
});
