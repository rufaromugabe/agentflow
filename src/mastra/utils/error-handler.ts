import { logger } from './logger';
import { AgentFlowError } from './helpers';

/**
 * Comprehensive Error Handling Utility for AgentFlow SaaS Platform
 * 
 * This utility provides robust error handling, categorization, and recovery mechanisms
 * for various types of errors that can occur in a SaaS environment with dynamic tools.
 */

export interface ErrorContext {
  toolId?: string;
  agentId?: string;
  organizationId?: string;
  userId?: string;
  requestId?: string;
  operation?: string;
  metadata?: Record<string, any>;
}

export interface ErrorRecoveryOptions {
  maxRetries?: number;
  retryDelay?: number;
  exponentialBackoff?: boolean;
  retryableErrors?: string[];
  fallbackAction?: () => Promise<any>;
}

export interface ErrorMetrics {
  errorType: string;
  errorCode: string;
  timestamp: string;
  context: ErrorContext;
  retryCount?: number;
  recoveryAttempted?: boolean;
  recoverySuccessful?: boolean;
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorMetrics: ErrorMetrics[] = [];
  private maxMetricsHistory = 1000;

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle and categorize errors with appropriate recovery mechanisms
   */
  async handleError(
    error: Error,
    context: ErrorContext,
    recoveryOptions?: ErrorRecoveryOptions
  ): Promise<{ handled: boolean; result?: any; shouldRetry: boolean }> {
    const errorMetrics: ErrorMetrics = {
      errorType: this.categorizeError(error),
      errorCode: this.extractErrorCode(error),
      timestamp: new Date().toISOString(),
      context,
    };

    this.recordErrorMetrics(errorMetrics);

    // Log the error with appropriate level
    this.logError(error, context, errorMetrics.errorType);

    // Determine if error is retryable
    const isRetryable = this.isRetryableError(error, recoveryOptions?.retryableErrors);
    
    if (isRetryable && recoveryOptions?.maxRetries && recoveryOptions.maxRetries > 0) {
      return await this.attemptRecovery(error, context, recoveryOptions, errorMetrics);
    }

    // Handle non-retryable errors
    return this.handleNonRetryableError(error, context, errorMetrics);
  }

  /**
   * Categorize errors for better handling and monitoring
   */
  private categorizeError(error: Error): string {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // API/Network errors
    if (message.includes('403') || message.includes('forbidden')) {
      return 'AUTHENTICATION_ERROR';
    }
    if (message.includes('401') || message.includes('unauthorized')) {
      return 'AUTHORIZATION_ERROR';
    }
    if (message.includes('429') || message.includes('rate limit')) {
      return 'RATE_LIMIT_ERROR';
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'TIMEOUT_ERROR';
    }
    if (message.includes('network') || message.includes('connection')) {
      return 'NETWORK_ERROR';
    }
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return 'SERVER_ERROR';
    }
    if (message.includes('404') || message.includes('not found')) {
      return 'NOT_FOUND_ERROR';
    }
    if (message.includes('400') || message.includes('bad request')) {
      return 'CLIENT_ERROR';
    }

    // Validation errors
    if (name.includes('validation') || message.includes('invalid')) {
      return 'VALIDATION_ERROR';
    }

    // Configuration errors
    if (message.includes('configuration') || message.includes('config')) {
      return 'CONFIGURATION_ERROR';
    }

    // Database errors
    if (message.includes('database') || message.includes('sql') || message.includes('connection')) {
      return 'DATABASE_ERROR';
    }

    // Tool-specific errors
    if (message.includes('tool') || message.includes('api call')) {
      return 'TOOL_ERROR';
    }

    // Default category
    return 'UNKNOWN_ERROR';
  }

  /**
   * Extract error code from error message or name
   */
  private extractErrorCode(error: Error): string {
    // Try to extract HTTP status code
    const statusMatch = error.message.match(/(\d{3})/);
    if (statusMatch) {
      return `HTTP_${statusMatch[1]}`;
    }

    // Try to extract specific error codes
    const codeMatch = error.message.match(/\[([A-Z_]+)\]/);
    if (codeMatch) {
      return codeMatch[1];
    }

    // Use error name as code
    return error.name.toUpperCase().replace(/\s+/g, '_');
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: Error, retryableErrors?: string[]): boolean {
    const errorType = this.categorizeError(error);
    const message = error.message.toLowerCase();

    // Non-retryable errors
    const nonRetryableTypes = [
      'AUTHENTICATION_ERROR',
      'AUTHORIZATION_ERROR',
      'VALIDATION_ERROR',
      'CONFIGURATION_ERROR',
      'NOT_FOUND_ERROR',
      'CLIENT_ERROR',
    ];

    if (nonRetryableTypes.includes(errorType)) {
      return false;
    }

    // Check custom retryable errors list
    if (retryableErrors && retryableErrors.length > 0) {
      return retryableErrors.some(retryableError => 
        message.includes(retryableError.toLowerCase())
      );
    }

    // Default retryable errors
    const defaultRetryableTypes = [
      'NETWORK_ERROR',
      'TIMEOUT_ERROR',
      'SERVER_ERROR',
      'RATE_LIMIT_ERROR',
      'TOOL_ERROR',
    ];

    return defaultRetryableTypes.includes(errorType);
  }

  /**
   * Attempt to recover from retryable errors
   */
  private async attemptRecovery(
    error: Error,
    context: ErrorContext,
    options: ErrorRecoveryOptions,
    metrics: ErrorMetrics
  ): Promise<{ handled: boolean; result?: any; shouldRetry: boolean }> {
    const maxRetries = options.maxRetries || 3;
    const baseDelay = options.retryDelay || 1000;
    const useExponentialBackoff = options.exponentialBackoff !== false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        metrics.retryCount = attempt;
        metrics.recoveryAttempted = true;

        logger.warn(`Attempting recovery (${attempt}/${maxRetries})`, {
          error: error.message,
          context,
          attempt,
          maxRetries,
        });

        // Calculate delay with exponential backoff
        const delay = useExponentialBackoff 
          ? baseDelay * Math.pow(2, attempt - 1)
          : baseDelay;

        await new Promise(resolve => setTimeout(resolve, delay));

        // Try fallback action if provided
        if (options.fallbackAction) {
          const result = await options.fallbackAction();
          metrics.recoverySuccessful = true;
          
          logger.info(`Recovery successful on attempt ${attempt}`, {
            context,
            attempt,
            result: typeof result === 'object' ? 'object' : result,
          });

          return { handled: true, result, shouldRetry: false };
        }

        // If no fallback action, just retry the original operation
        return { handled: false, shouldRetry: true };

      } catch (recoveryError) {
        logger.error(`Recovery attempt ${attempt} failed`, {
          originalError: error.message,
          recoveryError: recoveryError instanceof Error ? recoveryError.message : 'Unknown error',
          context,
          attempt,
        });

        if (attempt === maxRetries) {
          metrics.recoverySuccessful = false;
          return this.handleNonRetryableError(error, context, metrics);
        }
      }
    }

    return { handled: false, shouldRetry: false };
  }

  /**
   * Handle non-retryable errors
   */
  private handleNonRetryableError(
    error: Error,
    context: ErrorContext,
    metrics: ErrorMetrics
  ): { handled: boolean; result?: any; shouldRetry: boolean } {
    // Create user-friendly error message
    const userMessage = this.createUserFriendlyMessage(error, context);

    // Log final error
    logger.error(`Non-retryable error handled`, {
      error: error.message,
      userMessage,
      context,
      errorType: metrics.errorType,
      errorCode: metrics.errorCode,
    });

    // Return structured error response
    return {
      handled: true,
      result: {
        success: false,
        error: userMessage,
        errorType: metrics.errorType,
        errorCode: metrics.errorCode,
        context: this.sanitizeContext(context),
        timestamp: metrics.timestamp,
      },
      shouldRetry: false,
    };
  }

  /**
   * Create user-friendly error messages
   */
  private createUserFriendlyMessage(error: Error, context: ErrorContext): string {
    const errorType = this.categorizeError(error);
    const message = error.message;

    switch (errorType) {
      case 'AUTHENTICATION_ERROR':
        return 'Authentication failed. Please check your API key and ensure it has the correct permissions.';
      
      case 'AUTHORIZATION_ERROR':
        return 'Access denied. Your API key does not have permission to perform this action.';
      
      case 'RATE_LIMIT_ERROR':
        return 'Rate limit exceeded. Please wait a moment before trying again.';
      
      case 'TIMEOUT_ERROR':
        return 'Request timed out. The service may be experiencing high load. Please try again.';
      
      case 'NETWORK_ERROR':
        return 'Network connection failed. Please check your internet connection and try again.';
      
      case 'SERVER_ERROR':
        return 'The service is temporarily unavailable. Please try again in a few moments.';
      
      case 'NOT_FOUND_ERROR':
        return 'The requested resource was not found. Please check the resource ID and try again.';
      
      case 'VALIDATION_ERROR':
        return 'Invalid request parameters. Please check your input and try again.';
      
      case 'CONFIGURATION_ERROR':
        return 'Configuration error. Please check your tool settings and try again.';
      
      case 'TOOL_ERROR':
        return `Tool execution failed: ${message}`;
      
      default:
        return 'An unexpected error occurred. Please try again or contact support if the problem persists.';
    }
  }

  /**
   * Log errors with appropriate level and context
   */
  private logError(error: Error, context: ErrorContext, errorType: string): void {
    const logContext = {
      error: error.message,
      errorType,
      context: this.sanitizeContext(context),
      stack: error.stack,
    };

    // Use appropriate log level based on error type
    switch (errorType) {
      case 'AUTHENTICATION_ERROR':
      case 'AUTHORIZATION_ERROR':
        logger.warn('Authentication/Authorization error', logContext);
        break;
      
      case 'RATE_LIMIT_ERROR':
        logger.warn('Rate limit exceeded', logContext);
        break;
      
      case 'NETWORK_ERROR':
      case 'TIMEOUT_ERROR':
        logger.warn('Network/Timeout error', logContext);
        break;
      
      case 'SERVER_ERROR':
        logger.error('Server error', logContext);
        break;
      
      case 'VALIDATION_ERROR':
      case 'CONFIGURATION_ERROR':
        logger.warn('Validation/Configuration error', logContext);
        break;
      
      default:
        logger.error('Unknown error', logContext);
    }
  }

  /**
   * Sanitize context to remove sensitive information
   */
  private sanitizeContext(context: ErrorContext): ErrorContext {
    const sanitized = { ...context };
    
    // Remove or mask sensitive fields
    if (sanitized.metadata) {
      const sensitiveKeys = ['password', 'token', 'key', 'secret', 'apiKey'];
      const sanitizedMetadata = { ...sanitized.metadata };
      
      for (const key of sensitiveKeys) {
        if (sanitizedMetadata[key]) {
          sanitizedMetadata[key] = '***REDACTED***';
        }
      }
      
      sanitized.metadata = sanitizedMetadata;
    }

    return sanitized;
  }

  /**
   * Record error metrics for monitoring and analytics
   */
  private recordErrorMetrics(metrics: ErrorMetrics): void {
    this.errorMetrics.push(metrics);
    
    // Keep only the most recent metrics
    if (this.errorMetrics.length > this.maxMetricsHistory) {
      this.errorMetrics = this.errorMetrics.slice(-this.maxMetricsHistory);
    }
  }

  /**
   * Get error metrics for monitoring
   */
  getErrorMetrics(timeRange?: { start: Date; end: Date }): ErrorMetrics[] {
    if (!timeRange) {
      return [...this.errorMetrics];
    }

    return this.errorMetrics.filter(metric => {
      const metricTime = new Date(metric.timestamp);
      return metricTime >= timeRange.start && metricTime <= timeRange.end;
    });
  }

  /**
   * Get error statistics
   */
  getErrorStatistics(timeRange?: { start: Date; end: Date }): {
    total: number;
    byType: Record<string, number>;
    byCode: Record<string, number>;
    recoveryRate: number;
  } {
    const metrics = this.getErrorMetrics(timeRange);
    
    const byType: Record<string, number> = {};
    const byCode: Record<string, number> = {};
    let recoveryAttempts = 0;
    let successfulRecoveries = 0;

    for (const metric of metrics) {
      byType[metric.errorType] = (byType[metric.errorType] || 0) + 1;
      byCode[metric.errorCode] = (byCode[metric.errorCode] || 0) + 1;
      
      if (metric.recoveryAttempted) {
        recoveryAttempts++;
        if (metric.recoverySuccessful) {
          successfulRecoveries++;
        }
      }
    }

    return {
      total: metrics.length,
      byType,
      byCode,
      recoveryRate: recoveryAttempts > 0 ? successfulRecoveries / recoveryAttempts : 0,
    };
  }

  /**
   * Clear error metrics (useful for testing)
   */
  clearMetrics(): void {
    this.errorMetrics = [];
  }
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Export utility functions for common error handling patterns
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  recoveryOptions?: ErrorRecoveryOptions
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const result = await errorHandler.handleError(
      error instanceof Error ? error : new Error(String(error)),
      context,
      recoveryOptions
    );

    if (result.handled && result.result) {
      throw new AgentFlowError(
        result.result.error,
        result.result.errorCode,
        result.result.context
      );
    }

    throw error;
  }
}

export function createErrorContext(
  toolId?: string,
  agentId?: string,
  organizationId?: string,
  additionalContext?: Record<string, any>
): ErrorContext {
  return {
    toolId,
    agentId,
    organizationId,
    requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    operation: 'unknown',
    metadata: additionalContext,
  };
}
