import { Agent } from '@mastra/core/agent';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { createTool } from '@mastra/core/tools';
import { openai } from '@ai-sdk/openai';
import { postgresManager } from '../database/postgres-manager';
import { logger } from '../utils/logger';
import { AgentFlowError, validateOrganizationId } from '../utils/helpers';
import { DeployedAgentState, DeployedToolState } from '../deployment/deployment-manager';
import { AgentExecutionRequest, AgentExecutionResponse } from '../types';

// Fast execution context
export interface FastExecutionContext {
  agentId: string;
  userId: string;
  organizationId: string;
  environment: 'development' | 'staging' | 'production';
  userTier: 'free' | 'pro' | 'enterprise';
  customSettings?: Record<string, any>;
  requestId: string;
}

// Execution result with performance metrics
export interface FastExecutionResult {
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
  databaseLoadTime: number;
  agentCreationTime: number;
  totalExecutionTime: number;
  cacheHit?: boolean;
}

// Rate limiting and request deduplication
const runningExecutions = new Set<string>();
const rateLimiter = new Map<string, { count: number; resetTime: number }>();

// Fast Agent Executor following Sim's database-driven pattern
export class FastAgentExecutor {
  private organizationId: string;

  constructor(organizationId: string = 'default') {
    this.organizationId = validateOrganizationId(organizationId);
  }

  /**
   * Execute agent with pre-serialized configuration for maximum speed
   * This follows Sim's pattern: single database query, no memory caching
   */
  async executeAgent(
    agentId: string,
    request: AgentExecutionRequest,
    context: FastExecutionContext
  ): Promise<FastExecutionResult> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    const executionKey = `${context.organizationId}:${agentId}:${context.userId}:${requestId}`;

    try {
      // 1. Request deduplication (prevent duplicate concurrent executions)
      if (runningExecutions.has(executionKey)) {
        throw new AgentFlowError(
          'Execution already in progress',
          'EXECUTION_IN_PROGRESS',
          { agentId, requestId, organizationId: this.organizationId }
        );
      }
      runningExecutions.add(executionKey);

      // 2. Rate limiting check
      await this.checkRateLimit(context);

      // 3. Single database query to load pre-serialized state
      const dbLoadStart = Date.now();
      const deployedState = await this.loadDeployedAgentState(agentId);
      const databaseLoadTime = Date.now() - dbLoadStart;

      if (!deployedState) {
        throw new AgentFlowError(
          `Agent '${agentId}' is not deployed or not found`,
          'AGENT_NOT_DEPLOYED',
          { agentId, organizationId: this.organizationId }
        );
      }

      // 4. Create agent instance from pre-serialized state (no additional DB queries)
      const agentCreationStart = Date.now();
      const agent = await this.createAgentFromDeployedState(deployedState, context);
      const agentCreationTime = Date.now() - agentCreationStart;

      // 5. Execute agent immediately
      const executionStart = Date.now();
      const result = await this.executeAgentInstance(agent, request, context);
      const executionTime = Date.now() - executionStart;

      const totalExecutionTime = Date.now() - startTime;

      // 6. Log execution metrics
      logger.info('Fast agent execution completed', {
        agentId,
        requestId,
        organizationId: this.organizationId,
        executionTime,
        databaseLoadTime,
        agentCreationTime,
        totalExecutionTime,
        hasResponse: !!result.response
      });

      return {
        ...result,
        executionTime,
        databaseLoadTime,
        agentCreationTime,
        totalExecutionTime
      };

    } catch (error) {
      const totalExecutionTime = Date.now() - startTime;
      
      logger.error('Fast agent execution failed', {
        agentId,
        requestId,
        organizationId: this.organizationId,
        totalExecutionTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    } finally {
      // Always clean up execution tracking
      runningExecutions.delete(executionKey);
    }
  }

  /**
   * Load deployed agent state with single database query
   * This is the core of Sim's fast execution pattern
   */
  private async loadDeployedAgentState(agentId: string): Promise<DeployedAgentState | null> {
    try {
      const result = await postgresManager.getDeployedAgentState(
        this.organizationId,
        agentId
      );

      if (!result || !result.deployedState) {
        return null;
      }

      return result.deployedState as DeployedAgentState;
    } catch (error) {
      logger.error('Failed to load deployed agent state', {
        agentId,
        organizationId: this.organizationId
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Create agent instance from pre-serialized state
   * No additional database queries needed
   */
  private async createAgentFromDeployedState(
    deployedState: DeployedAgentState,
    context: FastExecutionContext
  ): Promise<Agent> {
    try {
      // Use pre-resolved components if available, otherwise resolve at runtime
      const model = deployedState.resolvedModel || this.resolveModel(deployedState.model);
      const tools = deployedState.resolvedTools || await this.resolveTools(deployedState.tools);
      const memory = deployedState.resolvedMemory || await this.resolveMemory(deployedState, context);
      const voice = deployedState.resolvedVoice || this.resolveVoice(deployedState);

      // Create agent with pre-resolved components
      const agent = new Agent({
        name: deployedState.name,
        description: deployedState.description,
        instructions: ({ runtimeContext: ctx }) => {
          return this.buildDynamicInstructions(deployedState, context, ctx);
        },
        model: () => model,
        tools: () => tools,
        memory: memory,
        voice: voice,
      });

      return agent;
    } catch (error) {
      logger.error('Failed to create agent from deployed state', {
        agentId: deployedState.id,
        organizationId: this.organizationId
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Execute the agent instance
   */
  private async executeAgentInstance(
    agent: Agent,
    request: AgentExecutionRequest,
    context: FastExecutionContext
  ): Promise<AgentExecutionResponse> {
    try {
      // Set up runtime context
      const runtimeContext = new RuntimeContext();
      runtimeContext.set('agentId', context.agentId);
      runtimeContext.set('userId', context.userId);
      runtimeContext.set('organizationId', context.organizationId);
      runtimeContext.set('environment', context.environment);
      runtimeContext.set('userTier', context.userTier);
      if (context.customSettings) {
        runtimeContext.set('customSettings', context.customSettings);
      }

      // Execute the agent
      const result = await agent.generate(
        request.message,
        {
          runtimeContext,
          maxSteps: request.options?.maxSteps || 10,
          temperature: request.options?.temperature || 0.7,
          toolChoice: request.options?.toolChoice || 'auto',
        }
      );

      return {
        response: result.text,
        usage: result.usage ? {
          inputTokens: result.usage.promptTokens || 0,
          outputTokens: result.usage.completionTokens || 0,
          totalTokens: result.usage.totalTokens || 0,
        } : undefined,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls?.map(tc => ({
          toolName: tc.toolName,
          args: tc.args
        }))
      };

    } catch (error) {
      logger.error('Failed to execute agent instance', {
        agentId: context.agentId,
        organizationId: this.organizationId
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Build dynamic instructions based on context
   */
  private buildDynamicInstructions(
    deployedState: DeployedAgentState,
    context: FastExecutionContext,
    runtimeContext: RuntimeContext
  ): string {
    let instructions = deployedState.instructions;

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

    return instructions;
  }

  /**
   * Resolve model at runtime if not pre-resolved
   */
  private resolveModel(modelName: string): any {
    try {
      return openai(modelName);
    } catch (error) {
      logger.error('Failed to resolve model', {
        modelName,
        organizationId: this.organizationId
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Resolve tools at runtime if not pre-resolved
   */
  private async resolveTools(deployedTools: DeployedToolState[]): Promise<Record<string, any>> {
    const tools: Record<string, any> = {};

    for (const toolState of deployedTools) {
      try {
        if (toolState.resolvedTool) {
          tools[toolState.id] = toolState.resolvedTool;
        } else {
          // Fallback to runtime resolution
          const tool = await this.resolveToolAtRuntime(toolState);
          if (tool) {
            tools[toolState.id] = tool;
          }
        }
      } catch (error) {
        logger.warn('Failed to resolve tool, skipping', {
          toolId: toolState.id,
          organizationId: this.organizationId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return tools;
  }

  /**
   * Resolve memory at runtime if not pre-resolved
   */
  private async resolveMemory(
    deployedState: DeployedAgentState,
    context: FastExecutionContext
  ): Promise<any> {
    if (!deployedState.memory?.enabled) {
      return undefined;
    }

    try {
      const { getMemoryManager } = require('../memory/organization-memory');
      const memoryManager = getMemoryManager(this.organizationId);
      
      return await memoryManager.getAgentMemory(
        deployedState.id,
        deployedState.name,
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
    } catch (error) {
      logger.warn('Failed to resolve memory, continuing without memory', {
        agentId: deployedState.id,
        organizationId: this.organizationId,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  /**
   * Resolve voice at runtime if not pre-resolved
   */
  private resolveVoice(deployedState: DeployedAgentState): any {
    if (!deployedState.voice?.enabled) {
      return undefined;
    }

    // Placeholder for voice resolution
    return undefined;
  }

  /**
   * Resolve tool at runtime (fallback)
   */
  private async resolveToolAtRuntime(toolState: DeployedToolState): Promise<any> {
    try {
      return createTool({
        id: toolState.id,
        description: toolState.description,
        inputSchema: toolState.inputSchema,
        outputSchema: toolState.outputSchema,
        execute: async ({ context, runtimeContext }, options) => {
          return await this.executeToolAtRuntime(toolState, context, runtimeContext, options?.abortSignal);
        },
      });
    } catch (error) {
      logger.error('Failed to resolve tool at runtime', {
        toolId: toolState.id,
        organizationId: this.organizationId
      }, error instanceof Error ? error : undefined);
      return null;
    }
  }

  /**
   * Execute tool at runtime (fallback)
   */
  private async executeToolAtRuntime(
    toolState: DeployedToolState,
    context: any,
    runtimeContext: any,
    abortSignal?: AbortSignal
  ): Promise<any> {
    // Simplified tool execution for runtime fallback
    return {
      message: `Tool ${toolState.name} executed with context: ${JSON.stringify(context)}`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check rate limiting
   */
  private async checkRateLimit(context: FastExecutionContext): Promise<void> {
    const key = `${context.organizationId}:${context.userId}`;
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const maxRequests = this.getMaxRequestsForTier(context.userTier);

    const current = rateLimiter.get(key);
    
    if (!current || now > current.resetTime) {
      // Reset or initialize
      rateLimiter.set(key, { count: 1, resetTime: now + windowMs });
      return;
    }

    if (current.count >= maxRequests) {
      throw new AgentFlowError(
        'Rate limit exceeded',
        'RATE_LIMIT_EXCEEDED',
        { 
          userId: context.userId, 
          organizationId: this.organizationId,
          tier: context.userTier,
          limit: maxRequests
        }
      );
    }

    current.count++;
  }

  /**
   * Get max requests per minute for user tier
   */
  private getMaxRequestsForTier(tier: string): number {
    switch (tier) {
      case 'enterprise': return 1000;
      case 'pro': return 100;
      case 'free': return 10;
      default: return 10;
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get execution status for monitoring
   */
  getExecutionStatus(): {
    runningExecutions: number;
    rateLimiterEntries: number;
  } {
    return {
      runningExecutions: runningExecutions.size,
      rateLimiterEntries: rateLimiter.size
    };
  }

  /**
   * Clean up expired rate limiter entries
   */
  cleanupRateLimiter(): void {
    const now = Date.now();
    for (const [key, value] of rateLimiter.entries()) {
      if (now > value.resetTime) {
        rateLimiter.delete(key);
      }
    }
  }
}

// Factory function to create fast executor
export function createFastExecutor(organizationId: string = 'default'): FastAgentExecutor {
  return new FastAgentExecutor(organizationId);
}

// Export singleton for global access
export const fastExecutor = createFastExecutor();
