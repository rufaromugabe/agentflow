import { createTool } from '@mastra/core/tools';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { z } from 'zod';
import { postgresManager } from '../database/postgres-manager';
import { createDeploymentManager } from '../deployment/deployment-manager';
import { logger } from '../utils/logger';
import { AgentFlowError, safeJsonParse, safeJsonStringify, validateOrganizationId } from '../utils/helpers';
import { cacheManager, cacheKey, invalidateToolCache } from '../utils/cache';
import { errorHandler, withErrorHandling, createErrorContext } from '../utils/error-handler';

// Import ToolConfig and ToolConfigSchema from types
import { ToolConfig, ToolConfigSchema } from '../types';

export interface ToolTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  template: Partial<ToolConfig>;
  examples: ToolConfig[];
  tags: string[];
}

export interface DynamicToolBuilder {
  initialize(): Promise<void>;
  createTool(config: ToolConfig): Promise<any>;
  createToolFromTemplate(templateId: string, customizations: Partial<ToolConfig>): Promise<any>;
  updateTool(toolId: string, updates: Partial<ToolConfig>): Promise<any>;
  getTool(toolId: string): any | null;
  listTools(): ToolConfig[];
  deleteTool(toolId: string): Promise<boolean>;
  createTemplate(template: ToolTemplate): ToolTemplate;
  getTemplates(): ToolTemplate[];
  validateToolConfig(config: ToolConfig): { valid: boolean; errors: string[] };
  healthCheck(toolId: string): Promise<{
    healthy: boolean;
    status: string;
    responseTime?: number;
    error?: string;
    lastChecked: string;
  }>;
  healthCheckAll(): Promise<Record<string, {
    healthy: boolean;
    status: string;
    responseTime?: number;
    error?: string;
    lastChecked: string;
  }>>;
  // Deployment methods
  deployTool(toolId: string, options?: any): Promise<any>;
  undeployTool(toolId: string): Promise<boolean>;
  isToolDeployed(toolId: string): Promise<boolean>;
  getDeployedToolState(toolId: string): Promise<any>;
}

// Dynamic Tool Builder Implementation
export class DynamicToolBuilderImpl implements DynamicToolBuilder {
  private tools: Map<string, any> = new Map();
  private configs: Map<string, ToolConfig> = new Map();
  private templates: Map<string, ToolTemplate> = new Map();
  private deploymentManager: any;
  private organizationId: string;

  constructor(organizationId: string = 'default') {
    this.organizationId = validateOrganizationId(organizationId);
    this.initializeDefaultTemplates();
  }

  async initialize(): Promise<void> {
    try {
      await postgresManager.initializeOrganization(this.organizationId);
      // Load existing tools from database
      await this.loadToolsFromDatabase();
      // Initialize the deployment manager
      this.deploymentManager = createDeploymentManager(this.organizationId);
    } catch (error) {
      console.error('Failed to initialize database for tools:', error);
    }
  }

  private async loadToolsFromDatabase() {
    try {
      const dbTools = await postgresManager.listTools(this.organizationId);
      for (const dbTool of dbTools) {
        const config: ToolConfig = {
          id: dbTool.id,
          name: dbTool.name,
          description: dbTool.description,
          inputSchema: dbTool.input_schema,
          outputSchema: dbTool.output_schema,
          apiEndpoint: dbTool.api_endpoint,
          method: dbTool.method,
          headers: dbTool.headers,
          authentication: dbTool.authentication,
          rateLimit: dbTool.rate_limit,
          timeout: dbTool.timeout,
          retries: dbTool.retries,
          cache: dbTool.cache_config,
          validation: dbTool.validation_config,
          status: dbTool.status,
          metadata: dbTool.metadata,
          createdAt: new Date(dbTool.created_at),
          updatedAt: new Date(dbTool.updated_at),
        };
        
        // Create the tool instance and store in memory
        const tool = createTool({
          id: config.id,
          description: config.description,
          inputSchema: this.buildInputSchema(config.inputSchema),
          outputSchema: config.outputSchema ? this.buildOutputSchema(config.outputSchema) : undefined,
          execute: async ({ context, runtimeContext }, options) => {
            return await this.executeTool(config, context, runtimeContext, options?.abortSignal);
          },
        });

        this.tools.set(config.id, tool);
        this.configs.set(config.id, config);
      }
    } catch (error) {
      console.error('Failed to load tools from database:', error);
    }
  }

  private initializeDefaultTemplates() {
    // HTTP API Tool Template
    const httpApiTemplate: ToolTemplate = {
      id: 'http-api',
      name: 'HTTP API Tool',
      description: 'Generic tool for making HTTP API calls',
      category: 'api',
      template: {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        retries: 3,
        validation: {
          enabled: true,
        },
      },
      examples: [],
      tags: ['http', 'api', 'rest'],
    };

    // Gemini API Template
    const geminiTemplate: ToolTemplate = {
      id: 'gemini-api',
      name: 'Gemini API Tool',
      description: 'Tool for making calls to Google Gemini API',
      category: 'ai',
      template: {
        name: 'Gemini API Tool',
        description: 'Make calls to Google Gemini API',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to send to Gemini API',
            },
          },
          required: ['text'],
        },
        apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
        method: 'POST',
        contentType: 'application/json',
        authentication: {
          type: 'api_key',
          config: {
            name: 'key',
            in: 'query', // Gemini expects API key as query parameter
            value: 'YOUR_GEMINI_API_KEY',
          },
        },
        metadata: {
          apiType: 'gemini',
        },
        timeout: 30000,
        retries: 3,
        cache: {
          enabled: true,
          ttl: 300, // 5 minutes
        },
      },
      examples: [],
      tags: ['gemini', 'google', 'ai', 'llm'],
    };

    // Weather API Template
    const weatherTemplate: ToolTemplate = {
      id: 'weather-api',
      name: 'Weather API Tool',
      description: 'Tool for fetching weather information',
      category: 'weather',
      template: {
        name: 'Weather Tool',
        description: 'Get current weather information for a location',
        inputSchema: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name or coordinates',
            },
            units: {
              type: 'string',
              enum: ['metric', 'imperial'],
              default: 'metric',
            },
          },
          required: ['location'],
        },
        method: 'GET',
        timeout: 10000,
        cache: {
          enabled: true,
          ttl: 300, // 5 minutes
        },
      },
      examples: [],
      tags: ['weather', 'api', 'location'],
    };

    // Database Query Template
    const databaseTemplate: ToolTemplate = {
      id: 'database-query',
      name: 'Database Query Tool',
      description: 'Tool for executing database queries',
      category: 'database',
      template: {
        name: 'Database Query Tool',
        description: 'Execute database queries safely',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute',
            },
            parameters: {
              type: 'array',
              description: 'Query parameters',
            },
          },
          required: ['query'],
        },
        validation: {
          enabled: true,
        },
        timeout: 60000,
      },
      examples: [],
      tags: ['database', 'sql', 'query'],
    };

    this.templates.set(httpApiTemplate.id, httpApiTemplate);
    this.templates.set(geminiTemplate.id, geminiTemplate);
    this.templates.set(weatherTemplate.id, weatherTemplate);
    this.templates.set(databaseTemplate.id, databaseTemplate);
  }

  async createTool(config: ToolConfig): Promise<any> {
    const validation = this.validateToolConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid tool configuration: ${validation.errors.join(', ')}`);
    }

    // Check if tool already exists in memory
    if (this.configs.has(config.id)) {
      throw new AgentFlowError(
        `Tool with ID '${config.id}' already exists`,
        'TOOL_ALREADY_EXISTS',
        { toolId: config.id, organizationId: this.organizationId }
      );
    }

    try {
      // Check if tool exists in database first
      const existingDbTool = await postgresManager.getTool(this.organizationId, config.id);
      if (existingDbTool) {
        throw new AgentFlowError(
          `Tool with ID '${config.id}' already exists in database`,
          'TOOL_ALREADY_EXISTS',
          { toolId: config.id, organizationId: this.organizationId }
        );
      }

      // Persist to database first
      const dbTool = await postgresManager.createTool(this.organizationId, {
        id: config.id,
        name: config.name,
        description: config.description,
        input_schema: config.inputSchema,
        output_schema: config.outputSchema,
        api_endpoint: config.apiEndpoint,
        method: config.method,
        headers: config.headers,
        authentication: config.authentication,
        rate_limit: config.rateLimit,
        timeout: config.timeout,
        retries: config.retries,
        cache_config: config.cache,
        validation_config: config.validation,
        status: config.status,
        metadata: config.metadata,
        created_at: config.createdAt,
        updated_at: config.updatedAt,
        workspace_id: null, // TODO: Add workspace support
      });

      // Create the tool instance
      const tool = createTool({
        id: config.id,
        description: config.description,
        inputSchema: this.buildInputSchema(config.inputSchema),
        outputSchema: config.outputSchema ? this.buildOutputSchema(config.outputSchema) : undefined,
        execute: async ({ context, runtimeContext }, options) => {
          return await this.executeTool(config, context, runtimeContext, options?.abortSignal);
        },
      });

      // Store in memory
      this.tools.set(config.id, tool);
      this.configs.set(config.id, config);

      // Invalidate tool cache since we've created a new tool
      invalidateToolCache(this.organizationId);
      
      logger.info('Tool created and cache invalidated', { 
        toolId: config.id, 
        organizationId: this.organizationId 
      });

      return tool;
    } catch (error) {
      // Handle database constraint violations
      if (error instanceof Error && error.message.includes('duplicate key value violates unique constraint')) {
        throw new AgentFlowError(
          `Tool with ID '${config.id}' already exists`,
          'TOOL_ALREADY_EXISTS',
          { toolId: config.id, organizationId: this.organizationId }
        );
      }
      
      console.error('Failed to create tool in database:', error);
      throw new Error(`Failed to create tool: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createToolFromTemplate(templateId: string, customizations: Partial<ToolConfig>): Promise<any> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template with ID ${templateId} not found`);
    }

    const config: ToolConfig = {
      id: customizations.id || `tool-${Date.now()}`,
      name: customizations.name || template.name,
      description: customizations.description || template.description,
      inputSchema: customizations.inputSchema || {},
      outputSchema: customizations.outputSchema,
      apiEndpoint: customizations.apiEndpoint,
      method: customizations.method || template.template.method || 'GET',
      headers: { ...template.template.headers, ...customizations.headers },
      authentication: customizations.authentication,
      rateLimit: customizations.rateLimit || template.template.rateLimit,
      timeout: customizations.timeout || template.template.timeout || 30000,
      retries: customizations.retries || template.template.retries || 3,
      cache: customizations.cache || template.template.cache,
      validation: customizations.validation || template.template.validation,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: customizations.status || 'active',
      metadata: { ...template.template, ...customizations.metadata },
    };

    return await this.createTool(config);
  }

  async updateTool(toolId: string, updates: Partial<ToolConfig>): Promise<any> {
    const existingConfig = this.configs.get(toolId);
    if (!existingConfig) {
      throw new Error(`Tool with ID ${toolId} not found`);
    }

    const updatedConfig = {
      ...existingConfig,
      ...updates,
      updatedAt: new Date(),
    };

    try {
      // Update in database
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.inputSchema !== undefined) dbUpdates.input_schema = updates.inputSchema;
      if (updates.outputSchema !== undefined) dbUpdates.output_schema = updates.outputSchema;
      if (updates.apiEndpoint !== undefined) dbUpdates.api_endpoint = updates.apiEndpoint;
      if (updates.method !== undefined) dbUpdates.method = updates.method;
      if (updates.headers !== undefined) dbUpdates.headers = updates.headers;
      if (updates.authentication !== undefined) dbUpdates.authentication = updates.authentication;
      if (updates.rateLimit !== undefined) dbUpdates.rate_limit = updates.rateLimit;
      if (updates.timeout !== undefined) dbUpdates.timeout = updates.timeout;
      if (updates.retries !== undefined) dbUpdates.retries = updates.retries;
      if (updates.cache !== undefined) dbUpdates.cache_config = updates.cache;
      if (updates.validation !== undefined) dbUpdates.validation_config = updates.validation;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;

      await postgresManager.updateTool(this.organizationId, toolId, dbUpdates);

      // Recreate tool instance with updated configuration (without calling createTool to avoid duplicate key error)
      const updatedTool = createTool({
        id: updatedConfig.id,
        description: updatedConfig.description,
        inputSchema: this.buildInputSchema(updatedConfig.inputSchema),
        outputSchema: updatedConfig.outputSchema ? this.buildOutputSchema(updatedConfig.outputSchema) : undefined,
        execute: async ({ context, runtimeContext }, options) => {
          return await this.executeTool(updatedConfig, context, runtimeContext, options?.abortSignal);
        },
      });
      
      this.tools.set(toolId, updatedTool);
      this.configs.set(toolId, updatedConfig);

      // Invalidate specific tool cache since we've updated it
      invalidateToolCache(this.organizationId, toolId);
      
      logger.info('Tool updated and cache invalidated', { 
        toolId, 
        organizationId: this.organizationId,
        updatedFields: Object.keys(updates)
      });

      return updatedTool;
    } catch (error) {
      console.error('Failed to update tool in database:', error);
      throw new Error(`Failed to update tool: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getTool(toolId: string): any | null {
    return this.tools.get(toolId) || null;
  }

  listTools(): ToolConfig[] {
    return Array.from(this.configs.values());
  }

  async deleteTool(toolId: string): Promise<boolean> {
    try {
      // Delete from database
      const dbDeleted = await postgresManager.deleteTool(this.organizationId, toolId);
      
      if (dbDeleted) {
        // Remove from memory
        this.tools.delete(toolId);
        this.configs.delete(toolId);
        
        // Invalidate specific tool cache since we've deleted it
        invalidateToolCache(this.organizationId, toolId);
        
        logger.info('Tool deleted and cache invalidated', { 
          toolId, 
          organizationId: this.organizationId 
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Failed to delete tool from database:', error);
      throw new Error(`Failed to delete tool: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  createTemplate(template: ToolTemplate): ToolTemplate {
    this.templates.set(template.id, template);
    return template;
  }

  getTemplates(): ToolTemplate[] {
    return Array.from(this.templates.values());
  }

  validateToolConfig(config: ToolConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.id || config.id.trim() === '') {
      errors.push('Tool ID is required');
    }

    if (!config.name || config.name.trim() === '') {
      errors.push('Tool name is required');
    }

    if (!config.description || config.description.trim() === '') {
      errors.push('Tool description is required');
    }

    if (!config.inputSchema || Object.keys(config.inputSchema).length === 0) {
      errors.push('Input schema is required');
    }

    if (config.apiEndpoint && !this.isValidUrl(config.apiEndpoint)) {
      errors.push('Invalid API endpoint URL');
    }

    if (config.timeout && config.timeout < 1000) {
      errors.push('Timeout must be at least 1000ms');
    }

    if (config.retries && config.retries < 0) {
      errors.push('Retries must be non-negative');
    }

    // Validate authentication configuration
    if (config.authentication) {
      try {
        this.validateAuthentication(config.authentication);
      } catch (error) {
        errors.push(`Authentication validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async healthCheck(toolId: string): Promise<{
    healthy: boolean;
    status: string;
    responseTime?: number;
    error?: string;
    lastChecked: string;
  }> {
    const config = this.configs.get(toolId);
    if (!config) {
      return {
        healthy: false,
        status: 'not_found',
        error: `Tool with ID '${toolId}' not found`,
        lastChecked: new Date().toISOString(),
      };
    }

    if (!config.apiEndpoint) {
      return {
        healthy: true,
        status: 'no_api_endpoint',
        lastChecked: new Date().toISOString(),
      };
    }

    try {
      const startTime = Date.now();
      
      // Create a simple health check request
      const healthCheckConfig = {
        ...config,
        method: 'GET' as const,
        timeout: 5000, // 5 second timeout for health checks
        retries: 1, // Only 1 retry for health checks
      };

      // Try to make a minimal request to check if the API is reachable
      const url = this.buildApiUrl(healthCheckConfig, {});
      const headers = this.buildHeaders(healthCheckConfig);
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        return {
          healthy: true,
          status: 'healthy',
          responseTime,
          lastChecked: new Date().toISOString(),
        };
      } else {
        return {
          healthy: false,
          status: 'unhealthy',
          responseTime,
          error: `HTTP ${response.status}: ${response.statusText}`,
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        healthy: false,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async healthCheckAll(): Promise<Record<string, {
    healthy: boolean;
    status: string;
    responseTime?: number;
    error?: string;
    lastChecked: string;
  }>> {
    const results: Record<string, any> = {};
    const toolIds = Array.from(this.configs.keys());

    // Run health checks in parallel with a limit to avoid overwhelming APIs
    const batchSize = 5;
    for (let i = 0; i < toolIds.length; i += batchSize) {
      const batch = toolIds.slice(i, i + batchSize);
      const batchPromises = batch.map(async (toolId) => {
        const result = await this.healthCheck(toolId);
        return { toolId, result };
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(({ toolId, result }) => {
        results[toolId] = result;
      });

      // Small delay between batches to be respectful to APIs
      if (i + batchSize < toolIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  private async executeTool(
    config: ToolConfig,
    context: any,
    runtimeContext: RuntimeContext,
    abortSignal?: AbortSignal
  ): Promise<any> {
    const errorContext = createErrorContext(
      config.id,
      undefined,
      this.organizationId,
      { operation: 'tool_execution', hasApiEndpoint: !!config.apiEndpoint }
    );

    return await withErrorHandling(
      async () => {
        // Check cache first
        if (config.cache?.enabled) {
          const cacheKey = this.generateCacheKey(config, context);
          const cached = this.getFromCache(cacheKey);
          if (cached) {
            logger.debug('Tool result served from cache', {
              toolId: config.id,
              organizationId: this.organizationId,
            });
            return cached;
          }
        }

        // Validate input if validation is enabled
        if (config.validation?.enabled) {
          this.validateInput(context, config.inputSchema);
        }

        let result: any;

        if (config.apiEndpoint) {
          // Execute API call with enhanced error handling
          result = await this.executeApiCall(config, context, abortSignal);
        } else {
          // Execute custom logic (placeholder for now)
          result = await this.executeCustomLogic(config, context, runtimeContext);
        }

        // Cache result if caching is enabled
        if (config.cache?.enabled) {
          const cacheKey = this.generateCacheKey(config, context);
          this.setCache(cacheKey, result, config.cache.ttl);
        }

        logger.info('Tool executed successfully', {
          toolId: config.id,
          organizationId: this.organizationId,
          hasResult: !!result,
        });

        return result;
      },
      errorContext,
      {
        maxRetries: config.retries || 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryableErrors: ['network', 'timeout', 'server', 'rate_limit'],
      }
    );
  }

  private async executeApiCall(
    config: ToolConfig,
    context: any,
    abortSignal?: AbortSignal
  ): Promise<any> {
    const url = this.buildApiUrl(config, context);
    const headers = this.buildHeaders(config);
    
    // Build request body based on content type
    let body: string | undefined = undefined;
    if (config.method !== 'GET') {
      body = this.buildRequestBody(config, context);
    }

    // Log request details (without sensitive information)
    const sanitizedHeaders = this.sanitizeHeaders(headers);
    logger.info(`Making API call to: ${url}`, {
      toolId: config.id,
      method: config.method,
      headers: sanitizedHeaders,
      hasBody: !!body,
      organizationId: this.organizationId
    });

    // Use retry mechanism for API calls
    return await this.retryApiCall(
      () => this.makeHttpRequest(url, headers, body, config.method || 'GET', abortSignal),
      config.retries || 3,
      config.timeout || 30000,
      config.id
    );
  }

  private async makeHttpRequest(
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    method: string,
    abortSignal?: AbortSignal
  ): Promise<any> {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: abortSignal,
    });

    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = 'Failed to read error response';
      }
      
      const errorDetails = this.parseErrorResponse(errorText, response.status);
      
      logger.error(`API call failed: ${response.status} ${response.statusText}`, {
        status: response.status,
        statusText: response.statusText,
        errorDetails,
        url: this.sanitizeUrl(url)
      });

      throw this.createApiError(response.status, response.statusText, errorDetails, url);
    }

    // Handle different response types
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      try {
        return await response.json();
      } catch (e) {
        logger.warn('Failed to parse JSON response, returning text', {
          url: this.sanitizeUrl(url),
          error: e instanceof Error ? e.message : 'Unknown error'
        });
        return await response.text();
      }
    } else if (contentType.includes('text/')) {
      return await response.text();
    } else {
      // For binary or unknown content types, return the response object
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text()
      };
    }
  }

  private async retryApiCall<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    timeout: number,
    toolId: string
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Add timeout to the operation
        return await Promise.race([
          operation(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Request timeout after ${timeout}ms`)), timeout)
          )
        ]);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        // Don't retry certain types of errors
        if (this.isNonRetryableError(lastError)) {
          logger.error(`Non-retryable error encountered`, {
            toolId,
            error: lastError.message,
            attempt
          });
          throw lastError;
        }
        
        if (attempt === maxRetries) {
          logger.error(`API call failed after ${maxRetries} attempts`, {
            toolId,
            attempts: maxRetries,
            finalError: lastError.message,
            organizationId: this.organizationId
          });
          throw lastError;
        }
        
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
        logger.warn(`API call failed, retrying in ${delay}ms`, {
          toolId,
          attempt,
          maxRetries,
          error: lastError.message,
          nextRetryIn: delay
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Don't retry authentication/authorization errors
    if (message.includes('401') || message.includes('unauthorized')) return true;
    if (message.includes('403') || message.includes('forbidden')) return true;
    if (message.includes('404') || message.includes('not found')) return true;
    
    // Don't retry client errors (4xx)
    if (message.includes('400') || message.includes('bad request')) return true;
    if (message.includes('422') || message.includes('unprocessable entity')) return true;
    
    // Don't retry timeout errors (they're already handled by the timeout mechanism)
    if (message.includes('timeout')) return true;
    
    return false;
  }

  private createApiError(status: number, statusText: string, errorDetails: any, url: string): Error {
    const sanitizedUrl = this.sanitizeUrl(url);
    
    switch (status) {
      case 400:
        return new Error(`Bad Request (400): Invalid request parameters. URL: ${sanitizedUrl}. Details: ${JSON.stringify(errorDetails)}`);
      case 401:
        return new Error(`Unauthorized (401): Invalid or missing API key. Please check your authentication configuration. URL: ${sanitizedUrl}`);
      case 403:
        return new Error(`Forbidden (403): API key doesn't have permission to access this resource or the API key is invalid. URL: ${sanitizedUrl}. Details: ${JSON.stringify(errorDetails)}`);
      case 404:
        return new Error(`Not Found (404): The requested resource was not found. URL: ${sanitizedUrl}`);
      case 429:
        return new Error(`Rate Limited (429): Too many requests. Please implement rate limiting or wait before retrying. URL: ${sanitizedUrl}`);
      case 500:
        return new Error(`Internal Server Error (500): The API server encountered an error. URL: ${sanitizedUrl}. Details: ${JSON.stringify(errorDetails)}`);
      case 502:
        return new Error(`Bad Gateway (502): The API server is temporarily unavailable. URL: ${sanitizedUrl}`);
      case 503:
        return new Error(`Service Unavailable (503): The API service is temporarily down. URL: ${sanitizedUrl}`);
      default:
        return new Error(`API call failed (${status} ${statusText}): URL: ${sanitizedUrl}. Details: ${JSON.stringify(errorDetails)}`);
    }
  }

  private parseErrorResponse(errorText: string, status: number): any {
    try {
      return JSON.parse(errorText);
    } catch {
      return { message: errorText, status };
    }
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized = { ...headers };
    
    // Remove or mask sensitive headers
    const sensitiveHeaders = ['authorization', 'x-api-key', 'api-key', 'cookie'];
    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '***REDACTED***';
      }
    }
    
    return sanitized;
  }

  private sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove API keys from query parameters
      const params = new URLSearchParams(urlObj.search);
      const sensitiveParams = ['key', 'api_key', 'apikey', 'token', 'access_token', 'auth', 'authorization'];
      
      for (const param of sensitiveParams) {
        if (params.has(param)) {
          params.set(param, '***REDACTED***');
        }
      }
      
      urlObj.search = params.toString();
      return urlObj.toString();
    } catch {
      return url; // Return original if URL parsing fails
    }
  }

  private async executeCustomLogic(
    config: ToolConfig,
    context: any,
    runtimeContext: RuntimeContext
  ): Promise<any> {
    // Placeholder for custom tool logic
    // This would be where you implement specific tool behaviors
    return {
      message: `Custom tool ${config.name} executed with context: ${JSON.stringify(context)}`,
      timestamp: new Date().toISOString(),
    };
  }

  private buildApiUrl(config: ToolConfig, context: any): string {
    let url = config.apiEndpoint!;
    
    // Replace URL parameters with context values
    Object.keys(context).forEach(key => {
      const value = context[key];
      if (value !== null && value !== undefined) {
        url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
      }
    });

    // Add query parameters for GET requests or when API key should be in query
    const params = new URLSearchParams();
    
    // Add API key as query parameter if configured that way
    if (config.authentication?.type === 'api_key' && config.authentication.config.in === 'query') {
      const apiKey = config.authentication.config.value || config.authentication.config.apiKey;
      const paramName = config.authentication.config.name || 'key';
      params.append(paramName, apiKey);
    }
    
    // Add context parameters for GET requests
    if (config.method === 'GET') {
      Object.keys(context).forEach(key => {
        const value = context[key];
        if (value !== null && value !== undefined) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            params.append(key, String(value));
          } else if (Array.isArray(value)) {
            // Handle arrays by joining with commas or adding multiple parameters
            value.forEach(item => {
              if (item !== null && item !== undefined) {
                params.append(key, String(item));
              }
            });
          }
        }
      });
    }
    
    if (params.toString()) {
      url += (url.includes('?') ? '&' : '?') + params.toString();
    }

    return url;
  }

  private buildHeaders(config: ToolConfig): Record<string, string> {
    const headers = { ...config.headers };

    // Set content type based on configuration
    if (config.contentType) {
      headers['Content-Type'] = config.contentType;
    } else {
      headers['Content-Type'] = 'application/json';
    }

    // Add authentication headers with validation
    if (config.authentication) {
      this.validateAuthentication(config.authentication);
      
      switch (config.authentication.type) {
        case 'api_key':
          this.addApiKeyAuthentication(headers, config.authentication.config);
          break;
        case 'bearer':
          this.addBearerAuthentication(headers, config.authentication.config);
          break;
        case 'basic':
          this.addBasicAuthentication(headers, config.authentication.config);
          break;
        default:
          throw new Error(`Unsupported authentication type: ${config.authentication.type}`);
      }
    }

    return headers;
  }

  private validateAuthentication(auth: any): void {
    if (!auth.type) {
      throw new Error('Authentication type is required');
    }

    if (!auth.config) {
      throw new Error('Authentication configuration is required');
    }

    switch (auth.type) {
      case 'api_key':
        this.validateApiKeyConfig(auth.config);
        break;
      case 'bearer':
        this.validateBearerConfig(auth.config);
        break;
      case 'basic':
        this.validateBasicConfig(auth.config);
        break;
      default:
        throw new Error(`Unsupported authentication type: ${auth.type}`);
    }
  }

  private validateApiKeyConfig(config: any): void {
    if (!config.value && !config.apiKey) {
      throw new Error('API key value is required for api_key authentication');
    }

    const apiKey = config.value || config.apiKey;
    if (!this.isValidApiKey(apiKey)) {
      throw new Error('Invalid API key format. API keys should be non-empty strings.');
    }
  }

  private validateBearerConfig(config: any): void {
    if (!config.token) {
      throw new Error('Token is required for bearer authentication');
    }

    if (typeof config.token !== 'string' || config.token.trim() === '') {
      throw new Error('Invalid bearer token format. Token should be a non-empty string.');
    }
  }

  private validateBasicConfig(config: any): void {
    if (!config.username || !config.password) {
      throw new Error('Username and password are required for basic authentication');
    }

    if (typeof config.username !== 'string' || config.username.trim() === '') {
      throw new Error('Invalid username format. Username should be a non-empty string.');
    }

    if (typeof config.password !== 'string') {
      throw new Error('Invalid password format. Password should be a string.');
    }
  }

  private isValidApiKey(apiKey: string): boolean {
    if (!apiKey || typeof apiKey !== 'string') {
      return false;
    }

    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      return false;
    }

    // Basic validation - API keys should be at least 10 characters
    if (trimmed.length < 10) {
      logger.warn('API key seems too short. Most API keys are longer than 10 characters.', {
        keyLength: trimmed.length,
        organizationId: this.organizationId
      });
    }

    return true;
  }

  private addApiKeyAuthentication(headers: Record<string, string>, config: any): void {
    const apiKey = config.value || config.apiKey;
    const headerName = config.name || 'X-API-Key';
    
    // Validate API key before adding to headers
    if (!this.isValidApiKey(apiKey)) {
      throw new Error('Invalid API key provided');
    }

    // Only add to headers if not configured to be in query parameters
    if (config.in !== 'query') {
      headers[headerName] = apiKey;
      
      logger.debug('API key authentication added to headers', {
        headerName,
        keyLength: apiKey.length,
        organizationId: this.organizationId
      });
    } else {
      logger.debug('API key authentication configured for query parameters', {
        paramName: config.name || 'key',
        keyLength: apiKey.length,
        organizationId: this.organizationId
      });
    }
  }

  private addBearerAuthentication(headers: Record<string, string>, config: any): void {
    const token = config.token;
    
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new Error('Invalid bearer token provided');
    }

    headers['Authorization'] = `Bearer ${token}`;
    
    logger.debug('Bearer authentication added', {
      tokenLength: token.length,
      organizationId: this.organizationId
    });
  }

  private addBasicAuthentication(headers: Record<string, string>, config: any): void {
    const username = config.username;
    const password = config.password;
    
    if (!username || !password) {
      throw new Error('Username and password are required for basic authentication');
    }

    const credentials = btoa(`${username}:${password}`);
    headers['Authorization'] = `Basic ${credentials}`;
    
    logger.debug('Basic authentication added', {
      username,
      organizationId: this.organizationId
    });
  }

  private applyBodyTransform(context: any, transform: any): any {
    try {
      // Handle different transform types
      if (typeof transform === 'function') {
        return transform(context);
      }
      
      if (typeof transform === 'object' && transform !== null) {
        // Handle template-based transformation
        if (transform.template) {
          return this.applyTemplateTransform(context, transform.template);
        }
        
        // Handle field mapping
        if (transform.fieldMapping) {
          return this.applyFieldMapping(context, transform.fieldMapping);
        }
        
        // Handle nested structure creation
        if (transform.structure) {
          return this.applyStructureTransform(context, transform.structure);
        }
      }
      
      return context;
    } catch (error) {
      logger.warn('Failed to apply body transform, using original context', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return context;
    }
  }

  private applyTemplateTransform(context: any, template: string): any {
    // Simple template replacement using {{field}} syntax
    let result = template;
    Object.keys(context).forEach(key => {
      const value = context[key];
      if (value !== null && value !== undefined) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
      }
    });
    
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }

  private applyFieldMapping(context: any, fieldMapping: Record<string, string>): any {
    const result: any = {};
    Object.entries(fieldMapping).forEach(([sourceField, targetField]) => {
      if (context[sourceField] !== undefined) {
        result[targetField] = context[sourceField];
      }
    });
    return result;
  }

  private applyStructureTransform(context: any, structure: any): any {
    // Apply nested structure transformation
    const result = JSON.parse(JSON.stringify(structure));
    
    const replacePlaceholders = (obj: any): any => {
      if (typeof obj === 'string') {
        // Replace {{field}} placeholders
        return obj.replace(/\{\{(\w+)\}\}/g, (match, field) => {
          return context[field] !== undefined ? String(context[field]) : match;
        });
      } else if (Array.isArray(obj)) {
        return obj.map(replacePlaceholders);
      } else if (typeof obj === 'object' && obj !== null) {
        const newObj: any = {};
        Object.keys(obj).forEach(key => {
          newObj[key] = replacePlaceholders(obj[key]);
        });
        return newObj;
      }
      return obj;
    };
    
    return replacePlaceholders(result);
  }

  private buildRequestBody(config: ToolConfig, context: any): string {
    const contentType = config.contentType || 'application/json';
    const bodyFormat = config.bodyFormat || 'json';

    // Handle null/undefined context
    if (context === null || context === undefined) {
      return '';
    }

    // Handle empty context
    if (typeof context === 'object' && Object.keys(context).length === 0) {
      return bodyFormat === 'json' ? '{}' : '';
    }

    // Apply body transformation if configured
    let transformedContext = context;
    if (config.metadata?.bodyTransform) {
      transformedContext = this.applyBodyTransform(context, config.metadata.bodyTransform);
    }

    try {
      switch (bodyFormat) {
        case 'form':
          return this.buildFormDataBody(transformedContext);
        case 'text':
          return this.buildTextBody(transformedContext);
        case 'xml':
          return this.buildXmlBody(transformedContext);
        case 'json':
        default:
          return JSON.stringify(transformedContext);
      }
    } catch (error) {
      logger.warn('Failed to build request body, falling back to JSON stringify', {
        toolId: config.id,
        bodyFormat,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return JSON.stringify(transformedContext);
    }
  }

  private buildFormDataBody(context: any): string {
    const formData = new URLSearchParams();
    
    // Handle nested objects by flattening them
    const flattenObject = (obj: any, prefix = ''): void => {
      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
          continue;
        }
        
        const fullKey = prefix ? `${prefix}[${key}]` : key;
        
        if (typeof value === 'object' && !Array.isArray(value)) {
          flattenObject(value, fullKey);
        } else if (Array.isArray(value)) {
          value.forEach((item, index) => {
            if (typeof item === 'object' && item !== null) {
              flattenObject(item, `${fullKey}[${index}]`);
            } else {
              formData.append(`${fullKey}[${index}]`, String(item));
            }
          });
        } else {
          formData.append(fullKey, String(value));
        }
      }
    };
    
    flattenObject(context);
    return formData.toString();
  }

  private buildTextBody(context: any): string {
    // For text/plain, we'll send the first text field or stringify the context
    if (typeof context === 'string') {
      return context;
    }
    
    // Try to find a text field with common names
    const textFields = ['text', 'content', 'message', 'body', 'data', 'input', 'query', 'prompt'];
    for (const field of textFields) {
      if (context[field] && typeof context[field] === 'string') {
        return context[field];
      }
    }
    
    // If it's a simple object with one string value, use that
    if (typeof context === 'object' && context !== null) {
      const entries = Object.entries(context);
      if (entries.length === 1 && typeof entries[0][1] === 'string') {
        return entries[0][1];
      }
    }
    
    // Fallback to JSON string for complex objects
    return JSON.stringify(context);
  }

  private buildXmlBody(context: any): string {
    // Simple XML builder - in production, you might want to use a proper XML library
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n';
    
    for (const [key, value] of Object.entries(context)) {
      if (value !== null && value !== undefined) {
        xml += `  <${key}>${this.escapeXml(String(value))}</${key}>\n`;
      }
    }
    
    xml += '</root>';
    return xml;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private buildInputSchema(schema: Record<string, any>): z.ZodSchema {
    // Convert JSON schema to Zod schema
    if (!schema || typeof schema !== 'object') {
      return z.object({});
    }

    // If it's already a Zod schema, return it
    if (schema._def || schema._zod) {
      return schema as z.ZodSchema;
    }

    // Convert JSON schema properties to Zod schema
    const zodSchema: Record<string, z.ZodTypeAny> = {};
    
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (typeof prop === 'object' && prop !== null) {
          const propSchema = prop as any;
          switch (propSchema.type) {
            case 'string':
              zodSchema[key] = z.string();
              break;
            case 'number':
              zodSchema[key] = z.number();
              break;
            case 'boolean':
              zodSchema[key] = z.boolean();
              break;
            case 'array':
              zodSchema[key] = z.array(z.any());
              break;
            default:
              zodSchema[key] = z.any();
          }
        } else {
          zodSchema[key] = z.any();
        }
      }
    }

    return z.object(zodSchema);
  }

  private buildOutputSchema(schema: Record<string, any>): z.ZodSchema {
    // Convert JSON schema to Zod schema
    if (!schema || typeof schema !== 'object') {
      return z.object({});
    }

    // If it's already a Zod schema, return it
    if (schema._def || schema._zod) {
      return schema as z.ZodSchema;
    }

    // Convert JSON schema properties to Zod schema
    const zodSchema: Record<string, z.ZodTypeAny> = {};
    
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (typeof prop === 'object' && prop !== null) {
          const propSchema = prop as any;
          switch (propSchema.type) {
            case 'string':
              zodSchema[key] = z.string();
              break;
            case 'number':
              zodSchema[key] = z.number();
              break;
            case 'boolean':
              zodSchema[key] = z.boolean();
              break;
            case 'array':
              zodSchema[key] = z.array(z.any());
              break;
            default:
              zodSchema[key] = z.any();
          }
        } else {
          zodSchema[key] = z.any();
        }
      }
    }

    return z.object(zodSchema);
  }

  private validateInput(input: any, schema: Record<string, any>): void {
    // Implement input validation based on schema
    // This is a placeholder implementation
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected object');
    }
  }

  private generateCacheKey(config: ToolConfig, context: any): string {
    return cacheKey('tool', this.organizationId, config.id, JSON.stringify(context));
  }

  private getFromCache(key: string): any | null {
    return cacheManager.get(key);
  }

  private setCache(key: string, data: any, ttl: number): void {
    cacheManager.set(key, data, ttl);
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // Deployment methods
  async deployTool(toolId: string, options: any = {}): Promise<any> {
    try {
      if (!this.deploymentManager) {
        throw new AgentFlowError(
          'Deployment manager not initialized',
          'DEPLOYMENT_MANAGER_NOT_INITIALIZED',
          { toolId, organizationId: this.organizationId }
        );
      }

      const result = await this.deploymentManager.deployTool(toolId, options);
      
      if (result.success) {
        logger.info('Tool deployed via builder', { 
          toolId, 
          organizationId: this.organizationId
        });
      }

      return result;
    } catch (error) {
      logger.error('Failed to deploy tool via builder', { 
        toolId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async undeployTool(toolId: string): Promise<boolean> {
    try {
      if (!this.deploymentManager) {
        throw new AgentFlowError(
          'Deployment manager not initialized',
          'DEPLOYMENT_MANAGER_NOT_INITIALIZED',
          { toolId, organizationId: this.organizationId }
        );
      }

      const success = await this.deploymentManager.undeployTool(toolId);
      
      if (success) {
        logger.info('Tool undeployed via builder', { 
          toolId, 
          organizationId: this.organizationId 
        });
      }

      return success;
    } catch (error) {
      logger.error('Failed to undeploy tool via builder', { 
        toolId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async isToolDeployed(toolId: string): Promise<boolean> {
    try {
      if (!this.deploymentManager) {
        return false;
      }

      const deployedState = await this.deploymentManager.getDeployedToolState(toolId);
      return !!deployedState;
    } catch (error) {
      logger.error('Failed to check tool deployment status', { 
        toolId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getDeployedToolState(toolId: string): Promise<any> {
    try {
      if (!this.deploymentManager) {
        return null;
      }

      return await this.deploymentManager.getDeployedToolState(toolId);
    } catch (error) {
      logger.error('Failed to get deployed tool state', { 
        toolId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      return null;
    }
  }
}

// Factory function to create tool builder
export function createDynamicToolBuilder(organizationId: string = 'default'): DynamicToolBuilder {
  return new DynamicToolBuilderImpl(organizationId);
}

