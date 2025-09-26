import { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { createDeploymentManager } from '../deployment/deployment-manager';
import { logger } from '../utils/logger';
import { AgentFlowError } from '../utils/helpers';
import { getAgentBuilder } from '../platform';

// Request validation schemas
const DeployAgentRequestSchema = z.object({
  agentId: z.string().min(1),
  options: z.object({
    validateConfigurations: z.boolean().optional(),
    preResolveDependencies: z.boolean().optional(),
    includeMetadata: z.boolean().optional(),
  }).optional(),
});



const ExecuteAgentRequestSchema = z.object({
  messages: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  message: z.string().optional(),
  output: z.record(z.any()).optional(),
  maxSteps: z.number().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  threadId: z.string().optional(),
  thread: z.string().optional(),
  resourceId: z.string().optional(),
  resource: z.string().optional(),
}).refine(data => data.messages || data.prompt || data.message, {
  message: "At least one of 'messages', 'prompt', or 'message' must be provided"
});

// Deployment API Controller
export class DeploymentAPI {
  constructor() {}

  /**
   * Deploy an agent for fast execution
   * POST /api/deploy/agents/:agentId
   */
  async deployAgent(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const organizationId = this.getOrganizationId(c);
      let body: any = {};
      try {
        body = await c.req.json();
      } catch {
        body = {};
      }
      
      const validatedData = DeployAgentRequestSchema.parse({
        agentId,
        ...body
      });

      const deploymentManager = createDeploymentManager(organizationId);
      const result = await deploymentManager.deployAgent(
        validatedData.agentId,
        validatedData.options
      );

      if (result.success) {
        logger.info('Agent deployed successfully via API', {
          agentId: validatedData.agentId,
          organizationId,
          toolCount: result.deployedAgentState?.tools?.length || 0
        });

        c.status(201);
        return c.json({
          success: true,
          data: {
            agentId: result.agentId,
            toolCount: result.deployedAgentState?.tools?.length || 0,
            deployedAt: new Date().toISOString(),
            warnings: result.warnings
          }
        });
      } else {
        c.status(400);
        return c.json({
          success: false,
          error: 'Deployment failed',
          details: result.errors
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        c.status(400);
        return c.json({
          success: false,
          error: 'Validation failed',
          details: error.errors
        });
      } else {
        logger.error('Agent deployment API error', {
          organizationId: this.getOrganizationId(c)
        }, error instanceof Error ? error : undefined);

        c.status(500);
        return c.json({
          success: false,
          error: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }



  /**
   * Undeploy an agent
   * DELETE /api/deploy/agents/:agentId
   */
  async undeployAgent(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const organizationId = this.getOrganizationId(c);

      const deploymentManager = createDeploymentManager(organizationId);
      const success = await deploymentManager.undeployAgent(agentId);

      if (success) {
        logger.info('Agent undeployed successfully via API', {
          agentId,
          organizationId
        });

        return c.json({
          success: true,
          message: 'Agent undeployed successfully'
        });
      } else {
        return c.json({
          success: false,
          error: 'Agent not found or not deployed'
        }, { status: 404 });
      }
    } catch (error) {
      logger.error('Agent undeployment API error', {
        organizationId: this.getOrganizationId(c)
      }, error instanceof Error ? error : undefined);

      return c.json({
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }



  /**
   * List deployed agents
   * GET /api/deploy/agents
   */
  async listDeployedAgents(c: Context): Promise<Response> {
    try {
      const organizationId = this.getOrganizationId(c);

      const deploymentManager = createDeploymentManager(organizationId);
      const deployedAgents = await deploymentManager.listDeployedAgents();

      return c.json({
        success: true,
        data: {
          agents: deployedAgents.map(agent => ({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            model: agent.model,
            toolCount: agent.tools ? agent.tools.length : 0,
            hasMemory: !!agent.memory?.enabled,
            hasVoice: !!agent.voice?.enabled
          }))
        }
      });
    } catch (error) {
      logger.error('List deployed agents API error', {
        organizationId: this.getOrganizationId(c)
      }, error instanceof Error ? error : undefined);

      return c.json({
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  }



  /**
   * Get deployment status for an agent
   * GET /api/deploy/agents/:agentId/status
   */
  async getAgentDeploymentStatus(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const organizationId = this.getOrganizationId(c);

      const deploymentManager = createDeploymentManager(organizationId);
      const deployedState = await deploymentManager.getDeployedAgentState(agentId);

      if (deployedState) {
        return c.json({
          success: true,
          data: {
            isDeployed: true,
            agentId: deployedState.id,
            name: deployedState.name,
            model: deployedState.model,
            toolCount: deployedState.tools ? deployedState.tools.length : 0,
            hasPreResolvedModel: !!deployedState.resolvedModel,
            hasPreResolvedTools: !!deployedState.resolvedTools,
            hasPreResolvedMemory: !!deployedState.resolvedMemory,
            hasPreResolvedVoice: !!deployedState.resolvedVoice
          }
        });
      } else {
        return c.json({
          success: true,
          data: {
            isDeployed: false,
            agentId
          }
        });
      }
    } catch (error) {
      logger.error('Get agent deployment status API error', {
        organizationId: this.getOrganizationId(c)
      }, error instanceof Error ? error : undefined);

      return c.json({
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }



  // Helper methods
  private getOrganizationId(c: Context): string {
    return c.req.header('x-organization-id') || 'default';
  }
}

// Fast Execution API Controller
export class FastExecutionAPI {
  constructor() {}

  /**
   * Execute deployed agent (fast path)
   * POST /api/execute/agents/:agentId
   */
  async executeAgent(c: Context): Promise<Response> {
    const { agentId } = c.req.param();
    
    try {
      const body = await c.req.json();
      const organizationId = this.getOrganizationId(c);
      
      // Get the deployed agent from the deployment manager instead of agent builder
      const deploymentManager = createDeploymentManager(organizationId);
      const deployedAgent = await deploymentManager.getDeployedAgentState(agentId);
      
      if (!deployedAgent) {
        return c.json({
          success: false,
          error: 'Agent not found',
          details: `Agent with ID '${agentId}' not deployed in organization '${organizationId}'`,
        }, 404);
      }

      // Build memory options (identical to regular generate endpoint)
      const memoryOptions: any = {};
      if (body.threadId || body.thread) {
        memoryOptions.thread = body.threadId || body.thread;
      }
      if (body.resourceId || body.resource) {
        memoryOptions.resource = body.resourceId || body.resource;
      }
      
      // Use the same agent retrieval approach as the working generate endpoint
      const agentBuilder = getAgentBuilder(organizationId);
      
      // Try to get the agent using the agent builder first (like the working endpoint does)
      let agent;
      try {
        agent = await agentBuilder.getAgent(agentId);
        logger.debug('Retrieved agent via agent builder', { agentId, organizationId });
      } catch (error) {
        // If agent builder fails, fall back to manual construction from deployed config
        logger.debug('Agent builder failed, using deployed configuration', { agentId, organizationId });
        const { Agent } = await import('@mastra/core/agent');
        
        agent = new Agent({
          name: deployedAgent.name,
          description: deployedAgent.description,
          instructions: deployedAgent.instructions,
          model: deployedAgent.resolvedModel || deployedAgent.model,
          tools: deployedAgent.resolvedTools || {},
          memory: deployedAgent.resolvedMemory,
          voice: deployedAgent.resolvedVoice,
        });
      }

      // Execute with EXACTLY the same logic as regular generate endpoint
      const result = await agent.generate(body.messages || body.prompt || body.message, {
        output: body.output,
        maxSteps: body.maxSteps,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        topP: body.topP,
        topK: body.topK,
        presencePenalty: body.presencePenalty,
        frequencyPenalty: body.frequencyPenalty,
        stopSequences: body.stopSequences,
        seed: body.seed,
        abortSignal: body.abortSignal,
        context: body.context,
        instructions: body.instructions,
        toolChoice: body.toolChoice,
        toolsets: body.toolsets,
        clientTools: body.clientTools,
        inputProcessors: body.inputProcessors,
        outputProcessors: body.outputProcessors,
        structuredOutput: body.structuredOutput,
        experimental_output: body.experimental_output,
        telemetry: body.telemetry,
        runtimeContext: body.runtimeContext,
        runId: body.runId,
        providerOptions: body.providerOptions,
        ...(Object.keys(memoryOptions).length > 0 && { memory: memoryOptions }),
      });

      // Return response in identical format to regular generate endpoint
      return c.json({
        success: true,
        data: {
          agentId,
          organizationId,
          result,
          memory: Object.keys(memoryOptions).length > 0 ? memoryOptions : null,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Execute deployed agent API error', {
        agentId,
        organizationId: this.getOrganizationId(c)
      }, error instanceof Error ? error : undefined);

      return c.json({
        success: false,
        error: 'Failed to generate response',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  /**
   * Get execution status and metrics
   * GET /api/execute/status
   */
  async getExecutionStatus(c: Context): Promise<Response> {
    try {
      const organizationId = this.getOrganizationId(c);
      const deploymentManager = createDeploymentManager(organizationId);
      const deployedAgents = await deploymentManager.listDeployedAgents();

      return c.json({
        success: true,
        data: {
          organizationId,
          deployedAgents: deployedAgents.length,
          agentIds: deployedAgents.map(agent => agent.id),
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Get execution status API error', {
        organizationId: this.getOrganizationId(c)
      }, error instanceof Error ? error : undefined);

      return c.json({
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  }

  // Helper methods
  private getOrganizationId(c: Context): string {
    return c.req.header('x-organization-id') || 'default';
  }

  private getUserId(c: Context): string {
    return c.req.header('x-user-id') || 'anonymous';
  }

  private getEnvironment(c: Context): 'development' | 'staging' | 'production' {
    return (c.req.header('x-environment') as any) || 'development';
  }

  private getUserTier(c: Context): 'free' | 'pro' | 'enterprise' {
    return (c.req.header('x-user-tier') as any) || 'free';
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getStatusCodeForError(errorCode: string): StatusCode {
    switch (errorCode) {
      case 'AGENT_NOT_DEPLOYED':
      case 'AGENT_NOT_FOUND':
        return 404 as StatusCode;
      case 'EXECUTION_IN_PROGRESS':
        return 409 as StatusCode;
      case 'RATE_LIMIT_EXCEEDED':
        return 429 as StatusCode;
      default:
        return 500 as StatusCode;
    }
  }
}

// Export API instances
export const deploymentAPI = new DeploymentAPI();
export const fastExecutionAPI = new FastExecutionAPI();
