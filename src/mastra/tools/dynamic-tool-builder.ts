import { createTool } from '@mastra/core/tools';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { z } from 'zod';
import { postgresManager } from '../database/postgres-manager';
import { logger } from '../utils/logger';
import { AgentFlowError, safeJsonParse, safeJsonStringify, validateOrganizationId } from '../utils/helpers';
import { cacheManager, cacheKey, invalidateToolCache } from '../utils/cache';

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
}

// Dynamic Tool Builder Implementation
export class DynamicToolBuilderImpl implements DynamicToolBuilder {
  private tools: Map<string, any> = new Map();
  private configs: Map<string, ToolConfig> = new Map();
  private templates: Map<string, ToolTemplate> = new Map();
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

      // Recreate tool with updated configuration
      const updatedTool = await this.createTool(updatedConfig);
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

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private async executeTool(
    config: ToolConfig,
    context: any,
    runtimeContext: RuntimeContext,
    abortSignal?: AbortSignal
  ): Promise<any> {
    try {
      // Check cache first
      if (config.cache?.enabled) {
        const cacheKey = this.generateCacheKey(config, context);
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          return cached;
        }
      }

      // Validate input if validation is enabled
      if (config.validation?.enabled) {
        this.validateInput(context, config.inputSchema);
      }

      let result: any;

      if (config.apiEndpoint) {
        // Execute API call
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

      return result;
    } catch (error) {
      console.error(`Tool execution error for ${config.id}:`, error);
      throw error;
    }
  }

  private async executeApiCall(
    config: ToolConfig,
    context: any,
    abortSignal?: AbortSignal
  ): Promise<any> {
    const url = this.buildApiUrl(config, context);
    const headers = this.buildHeaders(config);
    
    // Build request body based on content type and API type
    let body: string | undefined;
    if (config.method !== 'GET') {
      if (config.metadata?.apiType === 'gemini') {
        // Special handling for Gemini API
        body = JSON.stringify({
          contents: [{
            parts: [{
              text: context.text
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          }
        });
      } else {
        // Handle different content types
        body = this.buildRequestBody(config, context);
      }
    }

    console.log(`Making API call to: ${url}`);
    console.log(`Headers:`, headers);
    console.log(`Body:`, body);

    const response = await fetch(url, {
      method: config.method,
      headers,
      body,
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API call failed: ${response.status} ${response.statusText}`);
      console.error(`Response body:`, errorText);
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
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
      url = url.replace(`{${key}}`, encodeURIComponent(context[key]));
    });

    // Add query parameters for GET requests or when API key should be in query
    const params = new URLSearchParams();
    
    // Add API key as query parameter if configured that way
    if (config.authentication?.type === 'api_key' && config.authentication.config.in === 'query') {
      params.append(config.authentication.config.name || 'key', config.authentication.config.value);
    }
    
    // Add context parameters for GET requests
    if (config.method === 'GET') {
      Object.keys(context).forEach(key => {
        if (typeof context[key] === 'string' || typeof context[key] === 'number') {
          params.append(key, context[key].toString());
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

    // Add authentication headers
    if (config.authentication) {
      switch (config.authentication.type) {
        case 'api_key':
          // Handle different API key configurations
          if (config.authentication.config.apiKey) {
            headers['X-API-Key'] = config.authentication.config.apiKey;
          } else if (config.authentication.config.value) {
            // For APIs that expect API key in header
            headers['X-API-Key'] = config.authentication.config.value;
          }
          break;
        case 'bearer':
          headers['Authorization'] = `Bearer ${config.authentication.config.token}`;
          break;
        case 'basic':
          const credentials = btoa(`${config.authentication.config.username}:${config.authentication.config.password}`);
          headers['Authorization'] = `Basic ${credentials}`;
          break;
      }
    }

    return headers;
  }

  private buildRequestBody(config: ToolConfig, context: any): string {
    const contentType = config.contentType || 'application/json';
    const bodyFormat = config.bodyFormat || 'json';

    switch (bodyFormat) {
      case 'form':
        return this.buildFormDataBody(context);
      case 'text':
        return this.buildTextBody(context);
      case 'xml':
        return this.buildXmlBody(context);
      case 'json':
      default:
        return JSON.stringify(context);
    }
  }

  private buildFormDataBody(context: any): string {
    const formData = new URLSearchParams();
    
    for (const [key, value] of Object.entries(context)) {
      if (value !== null && value !== undefined) {
        formData.append(key, String(value));
      }
    }
    
    return formData.toString();
  }

  private buildTextBody(context: any): string {
    // For text/plain, we'll send the first text field or stringify the context
    if (typeof context === 'string') {
      return context;
    }
    
    if (context.text) {
      return String(context.text);
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
}

// Factory function to create tool builder
export function createDynamicToolBuilder(organizationId: string = 'default'): DynamicToolBuilder {
  return new DynamicToolBuilderImpl(organizationId);
}

