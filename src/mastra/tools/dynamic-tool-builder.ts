import { createTool } from '@mastra/core/tools';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { z } from 'zod';

// Types for dynamic tool configuration
export interface ToolConfig {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  apiEndpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  authentication?: {
    type: 'api_key' | 'bearer' | 'basic' | 'oauth2';
    config: Record<string, any>;
  };
  rateLimit?: {
    requests: number;
    window: number; // in seconds
  };
  timeout?: number;
  retries?: number;
  cache?: {
    enabled: boolean;
    ttl: number; // time to live in seconds
  };
  validation?: {
    enabled: boolean;
    schema?: Record<string, any>;
  };
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'inactive' | 'testing';
  metadata?: Record<string, any>;
}

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
  createTool(config: ToolConfig): any;
  createToolFromTemplate(templateId: string, customizations: Partial<ToolConfig>): any;
  updateTool(toolId: string, updates: Partial<ToolConfig>): any;
  getTool(toolId: string): any | null;
  listTools(): ToolConfig[];
  deleteTool(toolId: string): boolean;
  createTemplate(template: ToolTemplate): ToolTemplate;
  getTemplates(): ToolTemplate[];
  validateToolConfig(config: ToolConfig): { valid: boolean; errors: string[] };
}

// Dynamic Tool Builder Implementation
export class DynamicToolBuilderImpl implements DynamicToolBuilder {
  private tools: Map<string, any> = new Map();
  private configs: Map<string, ToolConfig> = new Map();
  private templates: Map<string, ToolTemplate> = new Map();
  private cache: Map<string, { data: any; timestamp: number; ttl: number }> = new Map();

  constructor() {
    this.initializeDefaultTemplates();
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

  createTool(config: ToolConfig): any {
    const validation = this.validateToolConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid tool configuration: ${validation.errors.join(', ')}`);
    }

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

    return tool;
  }

  createToolFromTemplate(templateId: string, customizations: Partial<ToolConfig>): any {
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

    return this.createTool(config);
  }

  updateTool(toolId: string, updates: Partial<ToolConfig>): any {
    const existingConfig = this.configs.get(toolId);
    if (!existingConfig) {
      throw new Error(`Tool with ID ${toolId} not found`);
    }

    const updatedConfig = {
      ...existingConfig,
      ...updates,
      updatedAt: new Date(),
    };

    // Recreate tool with updated configuration
    const updatedTool = this.createTool(updatedConfig);
    this.tools.set(toolId, updatedTool);
    this.configs.set(toolId, updatedConfig);

    return updatedTool;
  }

  getTool(toolId: string): any | null {
    return this.tools.get(toolId) || null;
  }

  listTools(): ToolConfig[] {
    return Array.from(this.configs.values());
  }

  deleteTool(toolId: string): boolean {
    const deleted = this.tools.delete(toolId) && this.configs.delete(toolId);
    return deleted;
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
    const body = config.method !== 'GET' ? JSON.stringify(context) : undefined;

    const response = await fetch(url, {
      method: config.method,
      headers,
      body,
      signal: abortSignal,
    });

    if (!response.ok) {
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

    // Add query parameters for GET requests
    if (config.method === 'GET') {
      const params = new URLSearchParams();
      Object.keys(context).forEach(key => {
        if (typeof context[key] === 'string' || typeof context[key] === 'number') {
          params.append(key, context[key].toString());
        }
      });
      if (params.toString()) {
        url += (url.includes('?') ? '&' : '?') + params.toString();
      }
    }

    return url;
  }

  private buildHeaders(config: ToolConfig): Record<string, string> {
    const headers = { ...config.headers };

    // Add authentication headers
    if (config.authentication) {
      switch (config.authentication.type) {
        case 'api_key':
          headers['X-API-Key'] = config.authentication.config.apiKey;
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
    return `${config.id}:${JSON.stringify(context)}`;
  }

  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl * 1000) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: any, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
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
export function createDynamicToolBuilder(): DynamicToolBuilder {
  return new DynamicToolBuilderImpl();
}

// Schema for tool configuration validation
export const ToolConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  inputSchema: z.record(z.any()),
  outputSchema: z.record(z.any()).optional(),
  apiEndpoint: z.string().url().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
  headers: z.record(z.string()).optional(),
  authentication: z.object({
    type: z.enum(['api_key', 'bearer', 'basic', 'oauth2']),
    config: z.record(z.any()),
  }).optional(),
  rateLimit: z.object({
    requests: z.number().positive(),
    window: z.number().positive(),
  }).optional(),
  timeout: z.number().positive().optional(),
  retries: z.number().min(0).optional(),
  cache: z.object({
    enabled: z.boolean(),
    ttl: z.number().positive(),
  }).optional(),
  validation: z.object({
    enabled: z.boolean(),
    schema: z.record(z.any()).optional(),
  }).optional(),
  status: z.enum(['active', 'inactive', 'testing']),
  metadata: z.record(z.any()).optional(),
});
