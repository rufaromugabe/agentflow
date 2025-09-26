import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { openai } from '@ai-sdk/openai';
import { postgresManager } from '../database/postgres-manager';
import { logger } from '../utils/logger';
import { AgentFlowError, validateOrganizationId, safeJsonParse } from '../utils/helpers';
import { AgentConfig, ToolConfig } from '../types';

// Deployment state interfaces
export interface DeployedAgentState {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  tools: DeployedToolState[];
  memory?: {
    enabled: boolean;
    storage?: string;
  };
  voice?: {
    enabled: boolean;
    provider?: string;
  };
  metadata?: Record<string, any>;
  // Pre-resolved configurations for instant execution
  resolvedModel?: any; // Pre-instantiated model
  resolvedTools?: Record<string, any>; // Pre-instantiated tools
  resolvedMemory?: any; // Pre-configured memory
  resolvedVoice?: any; // Pre-configured voice
}

export interface DeployedToolState {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  apiEndpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  authentication?: any;
  rateLimit?: any;
  timeout?: number;
  retries?: number;
  cache?: any;
  validation?: any;
  metadata?: Record<string, any>;
  // Pre-resolved configurations for instant execution
  resolvedTool?: any; // Pre-instantiated tool
}

export interface DeploymentOptions {
  validateConfigurations?: boolean;
  preResolveDependencies?: boolean;
  includeMetadata?: boolean;
}

export interface DeploymentResult {
  success: boolean;
  agentId?: string;
  toolIds?: string[];
  deployedAgentState?: DeployedAgentState;
  deployedToolState?: DeployedToolState;
  errors?: string[];
  warnings?: string[];
}

// Deployment Manager for pre-serializing agent configurations
export class DeploymentManager {
  private organizationId: string;

  constructor(organizationId: string = 'default') {
    this.organizationId = validateOrganizationId(organizationId);
  }

  /**
   * Deploy an agent with pre-serialized configuration for fast execution
   */
  async deployAgent(
    agentId: string, 
    options: DeploymentOptions = {}
  ): Promise<DeploymentResult> {
    try {
      logger.info('Starting agent deployment', { 
        agentId, 
        organizationId: this.organizationId 
      });

      // 1. Load agent configuration from database
      const agentConfig = await this.loadAgentConfiguration(agentId);
      if (!agentConfig) {
        throw new AgentFlowError(
          `Agent with ID '${agentId}' not found`,
          'AGENT_NOT_FOUND',
          { agentId, organizationId: this.organizationId }
        );
      }

      // 2. Validate configuration if requested
      if (options.validateConfigurations !== false) {
        const validation = await this.validateAgentConfiguration(agentConfig);
        if (!validation.valid) {
          return {
            success: false,
            errors: validation.errors
          };
        }
      }

      // 3. Pre-resolve and serialize agent configuration
      const deployedState = await this.preSerializeAgentConfiguration(
        agentConfig, 
        options
      );

      // 4. Load and embed tool configurations
      const toolDeploymentResults = await this.loadAndEmbedToolConfigurations(
        agentConfig.tools, 
        options
      );

      // 5. Update deployed state with tool information
      deployedState.tools = toolDeploymentResults.deployedTools;

      // 6. Save deployed state to database (clean version without circular references)
      const serializableDeployedState = {
        ...deployedState,
        tools: deployedState.tools ? deployedState.tools.map(tool => ({
          ...tool,
          resolvedTool: undefined // Remove circular references for JSON serialization
        })) : [],
        resolvedModel: undefined, // Remove potential circular references
        resolvedMemory: undefined, // Remove potential circular references
        resolvedVoice: undefined // Remove potential circular references
      };

      const deploymentSuccess = await postgresManager.deployAgent(
        this.organizationId,
        agentId,
        serializableDeployedState
      );

      if (!deploymentSuccess) {
        throw new AgentFlowError(
          'Failed to save deployed state to database',
          'DEPLOYMENT_SAVE_ERROR',
          { agentId, organizationId: this.organizationId }
        );
      }

      logger.info('Agent deployment completed successfully', { 
        agentId, 
        organizationId: this.organizationId,
        toolCount: deployedState.tools ? deployedState.tools.length : 0
      });

      return {
        success: true,
        agentId,
        deployedAgentState: deployedState,
        warnings: toolDeploymentResults.warnings
      };

    } catch (error) {
      logger.error('Agent deployment failed', { 
        agentId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);

      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown deployment error']
      };
    }
  }



  /**
   * Undeploy an agent (remove from fast execution)
   */
  async undeployAgent(agentId: string): Promise<boolean> {
    try {
      const success = await postgresManager.undeployAgent(
        this.organizationId,
        agentId
      );

      if (success) {
        logger.info('Agent undeployed successfully', { 
          agentId, 
          organizationId: this.organizationId 
        });
      }

      return success;
    } catch (error) {
      logger.error('Failed to undeploy agent', { 
        agentId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }



  /**
   * Get deployed agent state for fast execution
   */
  async getDeployedAgentState(agentId: string): Promise<DeployedAgentState | null> {
    try {
      const result = await postgresManager.getDeployedAgentState(
        this.organizationId,
        agentId
      );

      return result?.deployedState || null;
    } catch (error) {
      logger.error('Failed to get deployed agent state', { 
        agentId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }



  /**
   * List all deployed agents
   */
  async listDeployedAgents(): Promise<DeployedAgentState[]> {
    try {
      const results = await postgresManager.listDeployedAgents(this.organizationId);
      return results
        .map(result => result.deployedState)
        .filter((deployedState): deployedState is DeployedAgentState => {
          return deployedState !== null && deployedState !== undefined;
        });
    } catch (error) {
      logger.error('Failed to list deployed agents', { 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }



  // Private helper methods

  private async loadAgentConfiguration(agentId: string): Promise<AgentConfig | null> {
    const dbRow = await postgresManager.getAgent(this.organizationId, agentId);
    if (!dbRow) {
      return null;
    }

    return {
      id: dbRow.id,
      name: dbRow.name,
      description: dbRow.description,
      instructions: dbRow.instructions,
      model: dbRow.model,
      tools: safeJsonParse(dbRow.tools, []) || [],
      memory: safeJsonParse(dbRow.memory_config, undefined) || undefined,
      voice: safeJsonParse(dbRow.voice_config, undefined) || undefined,
      status: dbRow.status,
      metadata: safeJsonParse(dbRow.metadata, undefined) || undefined,
      createdAt: new Date(dbRow.created_at),
      updatedAt: new Date(dbRow.updated_at),
    };
  }

  private async loadToolConfiguration(toolId: string): Promise<ToolConfig | null> {
    const dbRow = await postgresManager.getTool(this.organizationId, toolId);
    if (!dbRow) {
      return null;
    }

    return {
      id: dbRow.id,
      name: dbRow.name,
      description: dbRow.description,
      inputSchema: safeJsonParse(dbRow.input_schema, {}) || {},
      outputSchema: safeJsonParse(dbRow.output_schema, undefined) || undefined,
      apiEndpoint: dbRow.api_endpoint,
      method: dbRow.method,
      headers: safeJsonParse(dbRow.headers, undefined) || undefined,
      authentication: safeJsonParse(dbRow.authentication, undefined) || undefined,
      rateLimit: safeJsonParse(dbRow.rate_limit, undefined) || undefined,
      timeout: dbRow.timeout,
      retries: dbRow.retries,
      cache: safeJsonParse(dbRow.cache_config, undefined) || undefined,
      validation: safeJsonParse(dbRow.validation_config, undefined) || undefined,
      status: dbRow.status,
      metadata: safeJsonParse(dbRow.metadata, undefined) || undefined,
      createdAt: new Date(dbRow.created_at),
      updatedAt: new Date(dbRow.updated_at),
    };
  }

  private async validateAgentConfiguration(config: AgentConfig): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!config.id || config.id.trim() === '') {
      errors.push('Agent ID is required');
    }

    if (!config.name || config.name.trim() === '') {
      errors.push('Agent name is required');
    }

    if (!config.instructions || config.instructions.trim() === '') {
      errors.push('Agent instructions are required');
    }

    if (!config.model || config.model.trim() === '') {
      errors.push('Agent model is required');
    }

    // Validate tools exist
    if (config.tools && config.tools.length > 0) {
      for (const toolId of config.tools) {
        const toolExists = await postgresManager.getTool(this.organizationId, toolId);
        if (!toolExists) {
          errors.push(`Tool with ID '${toolId}' not found`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private async validateToolConfiguration(config: ToolConfig): Promise<{ valid: boolean; errors: string[] }> {
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
      errors.push('Tool input schema is required');
    }

    if (config.apiEndpoint && !this.isValidUrl(config.apiEndpoint)) {
      errors.push('Invalid API endpoint URL');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private async preSerializeAgentConfiguration(
    config: AgentConfig, 
    options: DeploymentOptions
  ): Promise<DeployedAgentState> {
    const deployedState: DeployedAgentState = {
      id: config.id,
      name: config.name,
      description: config.description,
      instructions: config.instructions,
      model: config.model,
      tools: [],
      memory: config.memory,
      voice: config.voice,
      metadata: options.includeMetadata ? config.metadata : undefined,
    };

    // Pre-resolve model for instant execution
    if (options.preResolveDependencies !== false) {
      deployedState.resolvedModel = this.resolveModel(config.model);
    }

    // Pre-resolve memory if enabled
    if (config.memory?.enabled && options.preResolveDependencies !== false) {
      deployedState.resolvedMemory = await this.resolveMemory(config);
    }

    // Pre-resolve voice if enabled
    if (config.voice?.enabled && options.preResolveDependencies !== false) {
      deployedState.resolvedVoice = this.resolveVoice(config);
    }

    return deployedState;
  }

  private async preSerializeToolConfiguration(
    config: ToolConfig, 
    options: DeploymentOptions
  ): Promise<DeployedToolState> {
    const deployedState: DeployedToolState = {
      id: config.id,
      name: config.name,
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      apiEndpoint: config.apiEndpoint,
      method: config.method,
      headers: config.headers,
      authentication: config.authentication,
      rateLimit: config.rateLimit,
      timeout: config.timeout,
      retries: config.retries,
      cache: config.cache,
      validation: config.validation,
      metadata: options.includeMetadata ? config.metadata : undefined,
    };

    // Pre-resolve tool for instant execution
    if (options.preResolveDependencies !== false) {
      deployedState.resolvedTool = await this.resolveTool(config);
    }

    return deployedState;
  }

  private async loadAndEmbedToolConfigurations(
    toolIds: string[], 
    options: DeploymentOptions
  ): Promise<{ 
    deployedTools: DeployedToolState[]; 
    toolIds: string[]; 
    warnings: string[] 
  }> {
    const deployedTools: DeployedToolState[] = [];
    const warnings: string[] = [];

    for (const toolId of toolIds) {
      try {
        // Load tool configuration from database
        const toolConfig = await this.loadToolConfiguration(toolId);
        if (!toolConfig) {
          warnings.push(`Tool with ID '${toolId}' not found`);
          continue;
        }

        // Pre-serialize tool configuration with full config embedded
        const deployedToolState = await this.preSerializeToolConfiguration(toolConfig, options);
        deployedTools.push(deployedToolState);
        
        logger.debug('Tool configuration embedded in agent', { 
          toolId, 
          toolName: toolConfig.name,
          organizationId: this.organizationId 
        });
      } catch (error) {
        warnings.push(`Error loading tool ${toolId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      deployedTools,
      toolIds: toolIds,
      warnings
    };
  }

  private resolveModel(modelName: string): any {
    // Pre-instantiate the model for fast execution
    try {
      return openai(modelName);
    } catch (error) {
      logger.warn('Failed to resolve model, will resolve at runtime', { 
        modelName, 
        organizationId: this.organizationId 
      });
      return null;
    }
  }

  private async resolveMemory(config: AgentConfig): Promise<any> {
    // Pre-configure memory for fast execution
    try {
      // Import the organization memory implementation
      const { getMemoryManager } = require('../memory/organization-memory');
      
      // Get the memory manager for this organization
      const memoryManager = getMemoryManager(this.organizationId);
      
      // Get or create memory for this specific agent
      const memory = await memoryManager.getAgentMemory(
        config.id,
        config.name,
        {
          lastMessages: 15,
          semanticRecall: {
            topK: 3,
            messageRange: 2
          },
          workingMemory: true,
          scope: 'resource',
          generateTitle: true
        }
      );

      return memory;
    } catch (error) {
      logger.warn('Failed to resolve memory, will resolve at runtime', { 
        agentId: config.id, 
        organizationId: this.organizationId 
      });
      return null;
    }
  }

  private resolveVoice(config: AgentConfig): any {
    // Pre-configure voice for fast execution
    try {
      // Placeholder for voice configuration
      // This would integrate with your voice system
      return null;
    } catch (error) {
      logger.warn('Failed to resolve voice, will resolve at runtime', { 
        agentId: config.id, 
        organizationId: this.organizationId 
      });
      return null;
    }
  }

  private async resolveTool(config: ToolConfig): Promise<any> {
    // Pre-instantiate the tool for fast execution
    try {
      const tool = createTool({
        id: config.id,
        description: config.description,
        inputSchema: this.buildInputSchema(config.inputSchema),
        outputSchema: config.outputSchema ? this.buildOutputSchema(config.outputSchema) : undefined,
        execute: async ({ context, runtimeContext }, options) => {
          return await this.executeTool(config, context, runtimeContext, options?.abortSignal);
        },
      });

      return tool;
    } catch (error) {
      logger.warn('Failed to resolve tool, will resolve at runtime', { 
        toolId: config.id, 
        organizationId: this.organizationId 
      });
      return null;
    }
  }

  private buildInputSchema(schema: Record<string, any>): any {
    // Convert JSON schema to Zod schema for tool execution
    // This is a simplified implementation
    return schema;
  }

  private buildOutputSchema(schema: Record<string, any>): any {
    // Convert JSON schema to Zod schema for tool execution
    // This is a simplified implementation
    return schema;
  }

  private async executeTool(
    config: ToolConfig,
    context: any,
    runtimeContext: any,
    abortSignal?: AbortSignal
  ): Promise<any> {
    // Simplified tool execution for deployment
    // In production, this would use the full tool execution logic
    return {
      message: `Tool ${config.name} executed with context: ${JSON.stringify(context)}`,
      timestamp: new Date().toISOString(),
    };
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

// Factory function to create deployment manager
export function createDeploymentManager(organizationId: string = 'default'): DeploymentManager {
  return new DeploymentManager(organizationId);
}
