import { Agent } from '@mastra/core/agent';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { postgresManager } from '../database/postgres-manager';
import { createDynamicToolBuilder } from '../tools/dynamic-tool-builder';
import { createDeploymentManager } from '../deployment/deployment-manager';
import { logger } from '../utils/logger';
import { AgentFlowError, safeJsonParse, safeJsonStringify, validateOrganizationId } from '../utils/helpers';
import { cacheManager, cacheKey, invalidateAgentCache } from '../utils/cache';

// Types for dynamic agent configuration
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

export interface DynamicAgentBuilder {
  createAgent(config: AgentConfig): Promise<Agent>;
  updateAgent(agentId: string, updates: Partial<AgentConfig>): Promise<Agent>;
  getAgent(agentId: string): Promise<Agent | null>;
  listAgents(): Promise<AgentConfig[]>;
  deleteAgent(agentId: string): Promise<boolean>;
  registerTool(toolId: string, tool: any): void;
  // Deployment methods
  deployAgent(agentId: string, options?: any): Promise<any>;
  undeployAgent(agentId: string): Promise<boolean>;
  isAgentDeployed(agentId: string): Promise<boolean>;
  getDeployedAgentState(agentId: string): Promise<any>;
}

// Runtime context for dynamic agent configuration
export interface AgentRuntimeContext {
  agentId: string;
  userId: string;
  organizationId: string;
  environment: 'development' | 'staging' | 'production';
  userTier: 'free' | 'pro' | 'enterprise';
  customSettings?: Record<string, any>;
}

// Dynamic Agent Builder Implementation
export class DynamicAgentBuilderImpl implements DynamicAgentBuilder {
  private agents: Map<string, Agent> = new Map();
  private configs: Map<string, AgentConfig> = new Map();
  private toolRegistry: Map<string, any> = new Map();
  private toolBuilder: any;
  private deploymentManager: any;
  private organizationId: string = 'default';

  constructor(organizationId: string = 'default') {
    this.organizationId = validateOrganizationId(organizationId);
    this.initializeDefaultTools();
  }

  async initialize(): Promise<void> {
    try {
      // Initialize the database schema for this organization
      await postgresManager.initializeOrganization(this.organizationId);
      
      // Initialize the tool builder and load tools from database
      this.toolBuilder = createDynamicToolBuilder(this.organizationId);
      await this.toolBuilder.initialize();
      
      // Load tools from the tool builder into our registry
      const tools = this.toolBuilder.listTools();
      for (const toolConfig of tools) {
        const tool = this.toolBuilder.getTool(toolConfig.id);
        if (tool) {
          this.toolRegistry.set(toolConfig.id, tool);
        }
      }
      
      // Initialize the deployment manager
      this.deploymentManager = createDeploymentManager(this.organizationId);
      
      // Initialize the memory system for this organization
      const { initializeOrganizationMemory } = require('../memory/organization-memory');
      await initializeOrganizationMemory(this.organizationId);
      
      logger.info('Dynamic agent builder initialized', { 
        organizationId: this.organizationId, 
        toolCount: this.toolRegistry.size 
      });
    } catch (error) {
      logger.error('Failed to initialize dynamic agent builder', { organizationId: this.organizationId }, error instanceof Error ? error : undefined);
      throw new AgentFlowError(
        'Failed to initialize dynamic agent builder',
        'AGENT_BUILDER_INIT_ERROR',
        { organizationId: this.organizationId }
      );
    }
  }

  private initializeDefaultTools() {
    // Register default tools that can be used by any agent
    // This would be populated from your tool registry
  }

  async createAgent(config: AgentConfig): Promise<Agent> {
    // Check if agent already exists in memory
    if (this.configs.has(config.id)) {
      throw new AgentFlowError(
        `Agent with ID '${config.id}' already exists`,
        'AGENT_ALREADY_EXISTS',
        { agentId: config.id, organizationId: this.organizationId }
      );
    }

    // Check if agent already exists in database
    const existingDbAgent = await postgresManager.getAgent(this.organizationId, config.id);
    if (existingDbAgent) {
      throw new AgentFlowError(
        `Agent with ID '${config.id}' already exists in database`,
        'AGENT_ALREADY_EXISTS',
        { agentId: config.id, organizationId: this.organizationId }
      );
    }

    try {
      // Create agent instance
      const agent = await this.createAgentInstance(config);

      // Convert AgentConfig to database format and save to PostgreSQL
      const dbData = this.convertAgentConfigToDbRow(config);
      await postgresManager.createAgent(this.organizationId, dbData);

      this.agents.set(config.id, agent);
      this.configs.set(config.id, config);
      
      // Invalidate agent cache since we've created a new agent
      invalidateAgentCache(this.organizationId);
      
      logger.info('Agent created and cache invalidated', { 
        agentId: config.id, 
        organizationId: this.organizationId 
      });
      
      return agent;
    } catch (error) {
      // Handle database constraint violations
      if (error instanceof Error && error.message.includes('duplicate key value violates unique constraint')) {
        throw new AgentFlowError(
          `Agent with ID '${config.id}' already exists`,
          'AGENT_ALREADY_EXISTS',
          { agentId: config.id, organizationId: this.organizationId }
        );
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  private async createAgentInstance(config: AgentConfig): Promise<Agent> {
    const runtimeContext = new RuntimeContext<AgentRuntimeContext>();
    
    // Create dynamic agent with runtime context
    const agent = new Agent({
      name: config.name,
      description: config.description,
      instructions: ({ runtimeContext: ctx }) => {
        const agentCtx = ctx.get('agentContext') as AgentRuntimeContext;
        return this.buildDynamicInstructions(config, agentCtx);
      },
      model: ({ runtimeContext: ctx }) => {
        const agentCtx = ctx.get('agentContext') as AgentRuntimeContext;
        return this.selectModel(config, agentCtx);
      },
      tools: ({ runtimeContext: ctx }) => {
        const agentCtx = ctx.get('agentContext') as AgentRuntimeContext;
        return this.selectTools(config, agentCtx);
      },
      memory: config.memory?.enabled ? await this.createMemory(config) : undefined,
      voice: config.voice?.enabled ? this.createVoice(config) : undefined,
    });
    
    return agent;
  }

  private convertDbRowToAgentConfig(dbRow: any): AgentConfig {
    const config = {
      id: dbRow.id,
      name: dbRow.name,
      description: dbRow.description,
      instructions: dbRow.instructions,
      model: dbRow.model,
      tools: safeJsonParse(dbRow.tools, []) || [],
      memory: safeJsonParse(dbRow.memory_config),
      voice: safeJsonParse(dbRow.voice_config),
      status: dbRow.status,
      metadata: safeJsonParse(dbRow.metadata),
      createdAt: new Date(dbRow.created_at),
      updatedAt: new Date(dbRow.updated_at),
    };

    logger.debug('Converting database row to agent config', { 
      agentId: config.id, 
      model: config.model, 
      organizationId: this.organizationId 
    });
    return config;
  }

  private convertAgentConfigToDbRow(config: AgentConfig): any {
    return {
      id: config.id,
      name: config.name,
      description: config.description,
      instructions: config.instructions,
      model: config.model,
      tools: safeJsonStringify(config.tools),
      memory_config: config.memory ? safeJsonStringify(config.memory) : null,
      voice_config: config.voice ? safeJsonStringify(config.voice) : null,
      status: config.status,
      metadata: config.metadata ? safeJsonStringify(config.metadata) : null,
      created_at: config.createdAt,
      updated_at: config.updatedAt,
    };
  }

  private convertPartialAgentConfigToDbRow(updates: Partial<AgentConfig>): any {
    const dbUpdates: any = {};
    
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.instructions !== undefined) dbUpdates.instructions = updates.instructions;
    if (updates.model !== undefined) dbUpdates.model = updates.model;
    if (updates.tools !== undefined) dbUpdates.tools = safeJsonStringify(updates.tools);
    if (updates.memory !== undefined) dbUpdates.memory_config = updates.memory ? safeJsonStringify(updates.memory) : null;
    if (updates.voice !== undefined) dbUpdates.voice_config = updates.voice ? safeJsonStringify(updates.voice) : null;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata ? safeJsonStringify(updates.metadata) : null;
    if (updates.createdAt !== undefined) dbUpdates.created_at = updates.createdAt;
    if (updates.updatedAt !== undefined) dbUpdates.updated_at = updates.updatedAt;
    
    return dbUpdates;
  }

  async updateAgent(agentId: string, updates: Partial<AgentConfig>): Promise<Agent> {
    const existingConfig = this.configs.get(agentId);
    if (!existingConfig) {
      throw new AgentFlowError(
        `Agent with ID ${agentId} not found`,
        'AGENT_NOT_FOUND',
        { agentId, organizationId: this.organizationId }
      );
    }

    const updatedConfig = {
      ...existingConfig,
      ...updates,
      updatedAt: new Date(),
    };

    // Convert updates to database format and update in PostgreSQL
    const dbUpdates = this.convertPartialAgentConfigToDbRow(updates);
    await postgresManager.updateAgent(this.organizationId, agentId, dbUpdates);

    // Recreate agent with updated configuration
    const updatedAgent = await this.createAgentInstance(updatedConfig);
    this.agents.set(agentId, updatedAgent);
    this.configs.set(agentId, updatedConfig);

    // Invalidate specific agent cache since we've updated it
    invalidateAgentCache(this.organizationId, agentId);
    
    logger.info('Agent updated and cache invalidated', { 
      agentId, 
      organizationId: this.organizationId,
      updatedFields: Object.keys(updates)
    });

    return updatedAgent;
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    // Try to get from memory cache first
    let agent = this.agents.get(agentId);
    if (agent) {
      return agent;
    }

    // Try to get from centralized cache
    const cacheKeyStr = cacheKey('agent', this.organizationId, agentId);
    const cachedAgent = cacheManager.get<Agent>(cacheKeyStr);
    if (cachedAgent) {
      this.agents.set(agentId, cachedAgent);
      return cachedAgent;
    }

    // Load from PostgreSQL if not in cache
    const dbRow = await postgresManager.getAgent(this.organizationId, agentId);
    if (dbRow) {
      const config = this.convertDbRowToAgentConfig(dbRow);
      agent = await this.createAgentInstance(config);
      this.agents.set(agentId, agent);
      this.configs.set(agentId, config);
      
      // Cache the agent for future use
      cacheManager.set(cacheKeyStr, agent, 300); // 5 minutes
      
      return agent;
    }

    return null;
  }

  async listAgents(): Promise<AgentConfig[]> {
    // Load from PostgreSQL
    const dbRows = await postgresManager.listAgents(this.organizationId);
    
    // Convert database rows to AgentConfig objects
    const configs = dbRows.map(row => this.convertDbRowToAgentConfig(row));
    
    // Update cache
    this.configs.clear();
    configs.forEach(config => {
      this.configs.set(config.id, config);
    });

    return configs;
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    // Delete from PostgreSQL
    const deleted = await postgresManager.deleteAgent(this.organizationId, agentId);
    
    if (deleted) {
      // Remove from cache
      this.agents.delete(agentId);
      this.configs.delete(agentId);
      
      // Invalidate specific agent cache since we've deleted it
      invalidateAgentCache(this.organizationId, agentId);
      
      logger.info('Agent deleted and cache invalidated', { 
        agentId, 
        organizationId: this.organizationId 
      });
    }

    return deleted;
  }

  // Helper methods for dynamic configuration
  private buildDynamicInstructions(config: AgentConfig, context?: AgentRuntimeContext): string {
    let instructions = config.instructions;

    // Only add dynamic instructions if context is provided
    if (context) {
      // Add tier-specific instructions
      if (context.userTier === 'enterprise') {
        instructions += '\n\nYou have access to premium features and can provide advanced assistance.';
      } else if (context.userTier === 'pro') {
        instructions += '\n\nYou have access to professional features and can provide detailed assistance.';
      } else {
        instructions += '\n\nYou provide basic assistance. For advanced features, consider upgrading your plan.';
      }

      // Add environment-specific instructions
      if (context.environment === 'production') {
        instructions += '\n\nYou are operating in a production environment. Be extra careful with data handling.';
      }
    }

    return instructions;
  }

  private selectModel(config: AgentConfig, context?: AgentRuntimeContext) {
    // Use the model from the configuration (database) as the primary choice
    if (config.model) {
      logger.debug('Using model from database config', { 
        model: config.model, 
        agentId: config.id, 
        organizationId: this.organizationId 
      });
      return openai(config.model);
    }
    
    // Fallback to tier-based selection if no model is specified in config
    logger.debug('No model specified in config, using tier-based selection', { 
      agentId: config.id, 
      userTier: context?.userTier,
      organizationId: this.organizationId 
    });
    
    if (context?.userTier === 'enterprise') {
      return openai('gpt-4o'); // Premium model for enterprise
    } else if (context?.userTier === 'pro') {
      return openai('gpt-4o-mini'); // Good model for pro users
    } else {
      return openai('gpt-3.5-turbo'); // Basic model for free tier
    }
  }

  private selectTools(config: AgentConfig, context?: AgentRuntimeContext) {
    const selectedTools: Record<string, any> = {};

    // Add tools based on configuration and user tier
    config.tools.forEach(toolId => {
      const tool = this.toolRegistry.get(toolId);
      if (tool) {
        // Check if user tier allows this tool (default to allowing if no context)
        if (!context || this.isToolAllowedForTier(toolId, context.userTier)) {
          selectedTools[toolId] = tool;
        }
      }
    });

    return selectedTools;
  }

  private isToolAllowedForTier(toolId: string, tier: string): boolean {
    // Define tool access based on tiers
    const toolTiers: Record<string, string[]> = {
      'free': ['basic-tools'],
      'pro': ['basic-tools', 'advanced-tools'],
      'enterprise': ['basic-tools', 'advanced-tools', 'premium-tools']
    };

    return toolTiers[tier]?.includes(toolId) || false;
  }

  private async createMemory(config: AgentConfig) {
    // Create memory configuration based on agent settings
    if (!config.memory?.enabled) {
      return undefined;
    }

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
        }, // Enabled by default when pgvector is available
        workingMemory: true,
        scope: 'resource', // Default to resource-scoped memory
        generateTitle: true
      }
    );

    return memory;
  }

  private createVoice(config: AgentConfig) {
    // Create voice configuration based on agent settings
    // This would integrate with your voice system
    return undefined; // Placeholder
  }

  // Method to register tools dynamically
  registerTool(toolId: string, tool: any) {
    this.toolRegistry.set(toolId, tool);
    // Also register with the tool builder if it exists
    if (this.toolBuilder) {
      // This would create/update the tool in the database
      // For now, just ensure it's in our registry
    }
  }

  // Method to refresh tools from database
  async refreshTools(): Promise<void> {
    if (this.toolBuilder) {
      // Reload tools from database
      const tools = this.toolBuilder.listTools();
      this.toolRegistry.clear();
      
      for (const toolConfig of tools) {
        const tool = this.toolBuilder.getTool(toolConfig.id);
        if (tool) {
          this.toolRegistry.set(toolConfig.id, tool);
        }
      }
      
      logger.info('Refreshed tools from database', { 
        toolCount: this.toolRegistry.size, 
        organizationId: this.organizationId 
      });
    }
  }

  // Method to get agent with runtime context
  async getAgentWithContext(agentId: string, context: AgentRuntimeContext): Promise<Agent | null> {
    const agent = await this.getAgent(agentId);
    if (!agent) return null;

    // Set runtime context for this specific request
    const runtimeContext = new RuntimeContext<AgentRuntimeContext>();
    runtimeContext.set('agentId', context.agentId);
    runtimeContext.set('userId', context.userId);
    runtimeContext.set('organizationId', context.organizationId);
    runtimeContext.set('environment', context.environment);
    runtimeContext.set('userTier', context.userTier);
    if (context.customSettings) {
      runtimeContext.set('customSettings', context.customSettings);
    }

    return agent;
  }

  // Deployment methods
  async deployAgent(agentId: string, options: any = {}): Promise<any> {
    try {
      if (!this.deploymentManager) {
        throw new AgentFlowError(
          'Deployment manager not initialized',
          'DEPLOYMENT_MANAGER_NOT_INITIALIZED',
          { agentId, organizationId: this.organizationId }
        );
      }

      const result = await this.deploymentManager.deployAgent(agentId, options);
      
      if (result.success) {
        logger.info('Agent deployed via builder', { 
          agentId, 
          organizationId: this.organizationId,
          toolCount: result.toolIds?.length || 0
        });
      }

      return result;
    } catch (error) {
      logger.error('Failed to deploy agent via builder', { 
        agentId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async undeployAgent(agentId: string): Promise<boolean> {
    try {
      if (!this.deploymentManager) {
        throw new AgentFlowError(
          'Deployment manager not initialized',
          'DEPLOYMENT_MANAGER_NOT_INITIALIZED',
          { agentId, organizationId: this.organizationId }
        );
      }

      const success = await this.deploymentManager.undeployAgent(agentId);
      
      if (success) {
        logger.info('Agent undeployed via builder', { 
          agentId, 
          organizationId: this.organizationId 
        });
      }

      return success;
    } catch (error) {
      logger.error('Failed to undeploy agent via builder', { 
        agentId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async isAgentDeployed(agentId: string): Promise<boolean> {
    try {
      if (!this.deploymentManager) {
        return false;
      }

      const deployedState = await this.deploymentManager.getDeployedAgentState(agentId);
      return !!deployedState;
    } catch (error) {
      logger.error('Failed to check agent deployment status', { 
        agentId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getDeployedAgentState(agentId: string): Promise<any> {
    try {
      if (!this.deploymentManager) {
        return null;
      }

      return await this.deploymentManager.getDeployedAgentState(agentId);
    } catch (error) {
      logger.error('Failed to get deployed agent state', { 
        agentId, 
        organizationId: this.organizationId 
      }, error instanceof Error ? error : undefined);
      return null;
    }
  }
}

// Factory function to create agent builder
export function createDynamicAgentBuilder(organizationId: string = 'default'): DynamicAgentBuilder {
  return new DynamicAgentBuilderImpl(organizationId);
}

// Schema for agent configuration validation
export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  instructions: z.string().min(10),
  model: z.string(),
  tools: z.array(z.string()),
  memory: z.object({
    enabled: z.boolean(),
    storage: z.string().optional(),
  }).optional(),
  voice: z.object({
    enabled: z.boolean(),
    provider: z.string().optional(),
  }).optional(),
  status: z.enum(['active', 'inactive', 'testing']),
  metadata: z.record(z.any()).optional(),
});
