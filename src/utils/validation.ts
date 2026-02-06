import { z } from 'zod';
import { ValidationError } from './errors.js';

export function validate<T>(schema: z.ZodSchema<T>, data: unknown, fieldName = 'data'): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstError = result.error.errors[0];
    const path = firstError?.path.join('.') || fieldName;
    throw new ValidationError(
      firstError?.message || 'Validation failed',
      path,
      data
    );
  }
  return result.data;
}

export function validateOptional<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  fieldName = 'data'
): T | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }
  return validate(schema, data, fieldName);
}

export const NonEmptyStringSchema = z.string().min(1, 'String cannot be empty');

export const IdSchema = z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, {
  message: 'ID must contain only alphanumeric characters, underscores, and hyphens',
});

export const ConfidenceSchema = z.number().min(0).max(1);

export const PositiveIntegerSchema = z.number().int().positive();

export const TimestampSchema = z.union([z.date(), z.string().datetime()]).transform((val) => {
  return val instanceof Date ? val : new Date(val);
});

export function isValidId(id: string): boolean {
  return IdSchema.safeParse(id).success;
}

export function isValidConfidence(confidence: number): boolean {
  return ConfidenceSchema.safeParse(confidence).success;
}

export function sanitizeString(str: string): string {
  return str.trim().replace(/\s+/g, ' ');
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
