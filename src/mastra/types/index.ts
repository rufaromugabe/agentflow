// Shared types for the AgentFlow platform
import { z } from 'zod';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  tools: string[];
  memory?: {
    enabled: boolean;
    storage?: string;
  };
  voice?: {
    enabled: boolean;
    provider?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'inactive' | 'testing';
  metadata?: Record<string, any>;
}

export interface ToolConfig {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  apiEndpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  contentType?: 'application/json' | 'application/x-www-form-urlencoded' | 'text/plain' | 'text/xml' | 'application/xml';
  bodyFormat?: 'json' | 'form' | 'text' | 'xml';
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

export interface AgentRuntimeContext {
  agentId: string;
  userId: string;
  organizationId: string;
  environment: 'development' | 'staging' | 'production';
  userTier: 'free' | 'pro' | 'enterprise';
  customSettings?: Record<string, any>;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
}

export interface AgentExecutionRequest {
  message: string;
  context?: {
    memory?: {
      thread: string;
      resource: string;
    };
    runtimeContext?: AgentRuntimeContext;
  };
  options?: {
    maxSteps?: number;
    temperature?: number;
    toolChoice?: 'auto' | 'none' | 'required';
  };
}

export interface AgentExecutionResponse {
  response: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  toolCalls?: Array<{
    toolName: string;
    args: any;
  }>;
}

export interface ToolExecutionRequest {
  input: Record<string, any>;
  context?: {
    runtimeContext?: AgentRuntimeContext;
  };
}

export interface ToolExecutionResponse {
  result: any;
  metadata?: {
    executionTime: number;
    cacheHit?: boolean;
    retries?: number;
  };
}

export interface AnalyticsData {
  agentId: string;
  period: {
    startDate: string;
    endDate: string;
  };
  metrics: {
    totalRequests: number;
    averageResponseTime: number;
    successRate: number;
    errorRate: number;
    tokenUsage: {
      input: number;
      output: number;
      total: number;
    };
  };
}

export interface SandboxTestRequest {
  message: string;
  options?: {
    maxSteps?: number;
    temperature?: number;
    toolChoice?: 'auto' | 'none' | 'required';
  };
}

export interface SandboxTestResponse {
  response: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  toolCalls?: Array<{
    toolName: string;
    args: any;
  }>;
  executionTime: number;
}

// Database schema types
export interface DatabaseSchema {
  name: string; // Organization ID
  tables: {
    agents: AgentTable;
    tools: ToolTable;
    tool_templates: ToolTemplateTable;
    agent_executions: AgentExecutionTable;
    tool_executions: ToolExecutionTable;
    analytics: AnalyticsTable;
  };
}

export interface AgentTable {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  tools: string[]; // JSON array of tool IDs
  memory_config?: string; // JSON
  voice_config?: string; // JSON
  status: 'active' | 'inactive' | 'testing';
  metadata?: string; // JSON
  created_at: Date;
  updated_at: Date;
  workspace_id?: string; // For multi-workspace support
}

export interface ToolTable {
  id: string;
  name: string;
  description: string;
  input_schema: string; // JSON
  output_schema?: string; // JSON
  api_endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: string; // JSON
  content_type?: string;
  body_format?: string;
  authentication?: string; // JSON
  rate_limit?: string; // JSON
  timeout?: number;
  retries?: number;
  cache_config?: string; // JSON
  validation_config?: string; // JSON
  status: 'active' | 'inactive' | 'testing';
  metadata?: string; // JSON
  created_at: Date;
  updated_at: Date;
  workspace_id?: string; // For multi-workspace support
}

export interface ToolTemplateTable {
  id: string;
  name: string;
  description: string;
  category: string;
  template: string; // JSON
  examples: string; // JSON array
  tags: string; // JSON array
  created_at: Date;
  updated_at: Date;
}

export interface AgentExecutionTable {
  id: string;
  agent_id: string;
  user_id: string;
  organization_id: string;
  message: string;
  response: string;
  usage?: string; // JSON
  finish_reason?: string;
  tool_calls?: string; // JSON array
  execution_time: number;
  status: 'success' | 'error';
  error_message?: string;
  created_at: Date;
}

export interface ToolExecutionTable {
  id: string;
  tool_id: string;
  agent_id?: string;
  user_id: string;
  organization_id: string;
  input: string; // JSON
  output: string; // JSON
  execution_time: number;
  status: 'success' | 'error';
  error_message?: string;
  cache_hit?: boolean;
  retries?: number;
  created_at: Date;
}

export interface AnalyticsTable {
  id: string;
  agent_id?: string;
  tool_id?: string;
  user_id: string;
  organization_id: string;
  metric_type: 'request' | 'response_time' | 'token_usage' | 'error';
  metric_value: number;
  metadata?: string; // JSON
  timestamp: Date;
}

// WebSocket message types for real-time updates
export interface WebSocketMessage {
  type: 'agent_update' | 'tool_update' | 'execution_start' | 'execution_complete' | 'error';
  data: any;
  timestamp: Date;
}

export interface AgentUpdateMessage extends WebSocketMessage {
  type: 'agent_update';
  data: {
    agentId: string;
    status: 'active' | 'inactive' | 'testing';
    changes: Partial<AgentConfig>;
  };
}

export interface ToolUpdateMessage extends WebSocketMessage {
  type: 'tool_update';
  data: {
    toolId: string;
    status: 'active' | 'inactive' | 'testing';
    changes: Partial<ToolConfig>;
  };
}

export interface ExecutionStartMessage extends WebSocketMessage {
  type: 'execution_start';
  data: {
    executionId: string;
    agentId?: string;
    toolId?: string;
    userId: string;
    message?: string;
  };
}

export interface ExecutionCompleteMessage extends WebSocketMessage {
  type: 'execution_complete';
  data: {
    executionId: string;
    agentId?: string;
    toolId?: string;
    userId: string;
    success: boolean;
    response?: string;
    error?: string;
    executionTime: number;
  };
}

export interface ErrorMessage extends WebSocketMessage {
  type: 'error';
  data: {
    error: string;
    details?: any;
    context?: {
      agentId?: string;
      toolId?: string;
      userId?: string;
    };
  };
}

// Zod schemas for validation
export const ToolConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  inputSchema: z.record(z.any()),
  outputSchema: z.record(z.any()).optional(),
  apiEndpoint: z.string().url().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  headers: z.record(z.string()).optional(),
  contentType: z.enum(['application/json', 'application/x-www-form-urlencoded', 'text/plain', 'text/xml', 'application/xml']).optional(),
  bodyFormat: z.enum(['json', 'form', 'text', 'xml']).optional(),
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
