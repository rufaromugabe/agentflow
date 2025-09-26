import { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { createDeploymentManager } from '../deployment/deployment-manager';
import { createFastExecutor, FastExecutionContext } from '../execution/fast-executor';
import { logger } from '../utils/logger';
import { AgentFlowError } from '../utils/helpers';

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
  message: z.string().min(1),
  context: z.object({
    memory: z.object({
      thread: z.string().optional(),
      resource: z.string().optional(),
    }).optional(),
    runtimeContext: z.object({
      userId: z.string().min(1),
      environment: z.enum(['development', 'staging', 'production']).optional(),
      userTier: z.enum(['free', 'pro', 'enterprise']).optional(),
      customSettings: z.record(z.any()).optional(),
    }).optional(),
  }).optional(),
  options: z.object({
    maxSteps: z.number().min(1).max(50).optional(),
    temperature: z.number().min(0).max(2).optional(),
    toolChoice: z.enum(['auto', 'none', 'required']).optional(),
  }).optional(),
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
   * Execute agent with fast execution (pre-serialized configuration)
   * POST /api/execute/agents/:agentId
   */
  async executeAgent(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const organizationId = this.getOrganizationId(c);
      const body = await c.req.json();
      
      const validatedData = ExecuteAgentRequestSchema.parse(body);

      // Build execution context
      const context: FastExecutionContext = {
        agentId,
        userId: this.getUserId(c),
        organizationId,
        environment: this.getEnvironment(c),
        userTier: this.getUserTier(c),
        customSettings: validatedData.context?.runtimeContext?.customSettings,
        requestId: this.generateRequestId()
      };

      // Create fast executor and execute
      const fastExecutor = createFastExecutor(organizationId);
      const result = await fastExecutor.executeAgent(
        agentId,
        {
          message: validatedData.message,
          context: {
            memory: validatedData.context?.memory?.thread && validatedData.context?.memory?.resource
              ? {
                  thread: validatedData.context.memory.thread,
                  resource: validatedData.context.memory.resource
                }
              : undefined,
            runtimeContext: {
              agentId,
              organizationId,
              userId: context.userId,
              environment: context.environment,
              userTier: context.userTier,
              ...(validatedData.context?.runtimeContext || {})
            }
          },
          options: validatedData.options
        },
        context
      );

      logger.info('Fast agent execution completed via API', {
        agentId,
        organizationId,
        userId: context.userId,
        executionTime: result.totalExecutionTime,
        databaseLoadTime: result.databaseLoadTime
      });

      return c.json({
        success: true,
        data: {
          response: result.response,
          usage: result.usage,
          finishReason: result.finishReason,
          toolCalls: result.toolCalls,
          executionMetrics: {
            executionTime: result.executionTime,
            databaseLoadTime: result.databaseLoadTime,
            agentCreationTime: result.agentCreationTime,
            totalExecutionTime: result.totalExecutionTime
          }
        }
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({
          success: false,
          error: 'Validation failed',
          details: error.errors
        }, { status: 400 });
      } else if (error instanceof AgentFlowError) {
        const statusCode = this.getStatusCodeForError(error.code);
        c.status(statusCode);
        return c.json({
          success: false,
          error: error.message,
          code: error.code
        });
      } else {
        logger.error('Fast agent execution API error', {
          organizationId: this.getOrganizationId(c)
        }, error instanceof Error ? error : undefined);

        return c.json({
          success: false,
          error: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
      }
    }
  }

  /**
   * Get execution status and metrics
   * GET /api/execute/status
   */
  async getExecutionStatus(c: Context): Promise<Response> {
    try {
      const organizationId = this.getOrganizationId(c);
      const fastExecutor = createFastExecutor(organizationId);
      const status = fastExecutor.getExecutionStatus();

      return c.json({
        success: true,
        data: {
          organizationId,
          runningExecutions: status.runningExecutions,
          rateLimiterEntries: status.rateLimiterEntries,
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
