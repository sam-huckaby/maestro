import { z } from 'zod';
import {
  validate,
  validateOptional,
  isValidId,
  isValidConfidence,
  sanitizeString,
  truncateString,
  IdSchema,
  ConfidenceSchema,
} from '../../../src/utils/validation.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('Validation', () => {
  describe('validate', () => {
    it('should return data for valid input', () => {
      const schema = z.object({ name: z.string() });
      const result = validate(schema, { name: 'test' });
      expect(result).toEqual({ name: 'test' });
    });

    it('should throw ValidationError for invalid input', () => {
      const schema = z.object({ name: z.string() });
      expect(() => validate(schema, { name: 123 })).toThrow(ValidationError);
    });

    it('should include field name in error', () => {
      const schema = z.object({ name: z.string() });
      try {
        validate(schema, { name: 123 }, 'userData');
        fail('Expected error');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).field).toBe('name');
      }
    });
  });

  describe('validateOptional', () => {
    it('should return undefined for null/undefined', () => {
      const schema = z.string();
      expect(validateOptional(schema, null)).toBeUndefined();
      expect(validateOptional(schema, undefined)).toBeUndefined();
    });

    it('should validate non-null values', () => {
      const schema = z.string();
      expect(validateOptional(schema, 'test')).toBe('test');
    });
  });

  describe('IdSchema', () => {
    it('should accept valid IDs', () => {
      expect(IdSchema.safeParse('valid-id_123').success).toBe(true);
      expect(IdSchema.safeParse('ABC').success).toBe(true);
    });

    it('should reject invalid IDs', () => {
      expect(IdSchema.safeParse('').success).toBe(false);
      expect(IdSchema.safeParse('has spaces').success).toBe(false);
      expect(IdSchema.safeParse('has.dots').success).toBe(false);
    });
  });

  describe('isValidId', () => {
    it('should return true for valid IDs', () => {
      expect(isValidId('valid-id')).toBe(true);
      expect(isValidId('id_123')).toBe(true);
    });

    it('should return false for invalid IDs', () => {
      expect(isValidId('')).toBe(false);
      expect(isValidId('has spaces')).toBe(false);
    });
  });

  describe('ConfidenceSchema', () => {
    it('should accept valid confidence values', () => {
      expect(ConfidenceSchema.safeParse(0).success).toBe(true);
      expect(ConfidenceSchema.safeParse(0.5).success).toBe(true);
      expect(ConfidenceSchema.safeParse(1).success).toBe(true);
    });

    it('should reject invalid confidence values', () => {
      expect(ConfidenceSchema.safeParse(-0.1).success).toBe(false);
      expect(ConfidenceSchema.safeParse(1.1).success).toBe(false);
      expect(ConfidenceSchema.safeParse('0.5').success).toBe(false);
    });
  });

  describe('isValidConfidence', () => {
    it('should return true for valid confidence', () => {
      expect(isValidConfidence(0)).toBe(true);
      expect(isValidConfidence(0.6)).toBe(true);
      expect(isValidConfidence(1)).toBe(true);
    });

    it('should return false for invalid confidence', () => {
      expect(isValidConfidence(-0.1)).toBe(false);
      expect(isValidConfidence(1.1)).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    it('should trim whitespace', () => {
      expect(sanitizeString('  test  ')).toBe('test');
    });

    it('should collapse multiple spaces', () => {
      expect(sanitizeString('hello   world')).toBe('hello world');
    });

    it('should handle mixed whitespace', () => {
      expect(sanitizeString('  hello   world  ')).toBe('hello world');
    });
  });

  describe('truncateString', () => {
    it('should not truncate short strings', () => {
      expect(truncateString('short', 10)).toBe('short');
    });

    it('should truncate long strings with ellipsis', () => {
      expect(truncateString('this is a long string', 10)).toBe('this is...');
    });

    it('should handle exact length', () => {
      expect(truncateString('exact', 5)).toBe('exact');
    });
  });
});
