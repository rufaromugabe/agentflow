// Centralized utility functions for AgentFlow
import { logger } from './logger';

// Centralized JSON parsing with error handling
export function safeJsonParse<T = any>(value: any, defaultValue: T | null = null): T | null {
  if (!value) return defaultValue;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn('Failed to parse JSON', { value, error: error instanceof Error ? error.message : 'Unknown error' });
      return defaultValue;
    }
  }
  return value;
}

// Centralized JSON stringification with error handling
export function safeJsonStringify(value: any, defaultValue: string = '{}'): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    logger.warn('Failed to stringify JSON', { value, error: error instanceof Error ? error.message : 'Unknown error' });
    return defaultValue;
  }
}

// Standardized error handling
export class AgentFlowError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, any>;
  public readonly statusCode?: number;

  constructor(message: string, code: string, context?: Record<string, any>, statusCode?: number) {
    super(message);
    this.name = 'AgentFlowError';
    this.code = code;
    this.context = context;
    this.statusCode = statusCode;
  }
}

// Standardized result wrapper
export interface Result<T, E = AgentFlowError> {
  success: boolean;
  data?: T;
  error?: E;
}

export function createSuccessResult<T>(data: T): Result<T> {
  return { success: true, data };
}

export function createErrorResult<E = AgentFlowError>(error: E): Result<never, E> {
  return { success: false, error };
}

// Async wrapper for error handling
export async function safeAsync<T>(
  operation: () => Promise<T>,
  errorCode: string = 'UNKNOWN_ERROR',
  context?: Record<string, any>
): Promise<Result<T>> {
  try {
    const data = await operation();
    return createSuccessResult(data);
  } catch (error) {
    const agentFlowError = new AgentFlowError(
      error instanceof Error ? error.message : 'Unknown error',
      errorCode,
      context
    );
    logger.error(`Operation failed: ${errorCode}`, context, error instanceof Error ? error : undefined);
    return createErrorResult(agentFlowError);
  }
}

// Validation helpers
export function validateRequired(value: any, fieldName: string): void {
  if (value === undefined || value === null || value === '') {
    throw new AgentFlowError(`${fieldName} is required`, 'VALIDATION_ERROR', { fieldName });
  }
}

export function validateString(value: any, fieldName: string, minLength: number = 1, maxLength?: number): void {
  validateRequired(value, fieldName);
  if (typeof value !== 'string') {
    throw new AgentFlowError(`${fieldName} must be a string`, 'VALIDATION_ERROR', { fieldName, type: typeof value });
  }
  if (value.length < minLength) {
    throw new AgentFlowError(`${fieldName} must be at least ${minLength} characters`, 'VALIDATION_ERROR', { fieldName, length: value.length });
  }
  if (maxLength && value.length > maxLength) {
    throw new AgentFlowError(`${fieldName} must be at most ${maxLength} characters`, 'VALIDATION_ERROR', { fieldName, length: value.length });
  }
}

export function validateArray(value: any, fieldName: string, minLength: number = 0): void {
  validateRequired(value, fieldName);
  if (!Array.isArray(value)) {
    throw new AgentFlowError(`${fieldName} must be an array`, 'VALIDATION_ERROR', { fieldName, type: typeof value });
  }
  if (value.length < minLength) {
    throw new AgentFlowError(`${fieldName} must have at least ${minLength} items`, 'VALIDATION_ERROR', { fieldName, length: value.length });
  }
}

// Organization ID validation and normalization
export function validateOrganizationId(organizationId: string): string {
  validateString(organizationId, 'organizationId', 1, 100);
  
  // Normalize organization ID (remove special characters, convert to lowercase)
  const normalized = organizationId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  
  if (normalized !== organizationId) {
    logger.warn('Organization ID normalized', { original: organizationId, normalized });
  }
  
  return normalized;
}

// Cache key generation
export function generateCacheKey(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}:${parts.join(':')}`;
}

// Retry mechanism
export async function retry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
  context?: Record<string, any>
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      
      if (attempt === maxRetries) {
        logger.error(`Operation failed after ${maxRetries} attempts`, { ...context, attempt, error: lastError.message });
        throw lastError;
      }
      
      logger.warn(`Operation failed, retrying in ${delay}ms`, { ...context, attempt, maxRetries, error: lastError.message });
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  
  throw lastError!;
}
