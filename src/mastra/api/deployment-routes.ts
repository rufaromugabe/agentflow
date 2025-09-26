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
   * Execute deployed agent (optimized for maximum speed)
   * POST /api/execute/agents/:agentId
   */
  async executeAgent(c: Context): Promise<Response> {
    const { agentId } = c.req.param();
    
    try {
      const body = await c.req.json();
      const organizationId = this.getOrganizationId(c);
      
      // Single agent lookup - combines deployment check and agent retrieval
      const agentBuilder = getAgentBuilder(organizationId);
      const agent = await agentBuilder.getAgent(agentId);
      
      if (!agent) {
        return c.json({
          success: false,
          error: 'Agent not found or not deployed',
        }, 404);
      }

      // Build options object only with defined values (faster than spread operator)
      const options: any = {};
      
      // Memory options (only if needed)
      if (body.threadId || body.thread || body.resourceId || body.resource) {
        options.memory = {};
        if (body.threadId || body.thread) options.memory.thread = body.threadId || body.thread;
        if (body.resourceId || body.resource) options.memory.resource = body.resourceId || body.resource;
      }
      
      // Only add defined options (avoid undefined checks in Mastra)
      if (body.output !== undefined) options.output = body.output;
      if (body.maxSteps !== undefined) options.maxSteps = body.maxSteps;
      if (body.maxTokens !== undefined) options.maxTokens = body.maxTokens;
      if (body.temperature !== undefined) options.temperature = body.temperature;
      if (body.toolChoice !== undefined) options.toolChoice = body.toolChoice;
      if (body.structuredOutput !== undefined) options.structuredOutput = body.structuredOutput;
      if (body.providerOptions !== undefined) options.providerOptions = body.providerOptions;

      // Execute with optimized options
      const result = await agent.generate(body.messages || body.prompt || body.message, options);

      // Check if user wants minimal response (default) or full response
      const minimal = body.minimal !== false; // Default to minimal unless explicitly set to false

      if (minimal) {
        // Ultra-minimal response for maximum speed - just essential data
        return c.json({
          success: true,
          data: {
            text: result.text,
            toolCalls: result.toolCalls || [],
            toolResults: result.toolResults || [],
            finishReason: result.finishReason,
            usage: result.usage,
          },
        });
      } else {
        // Full response for users who need all the metadata
        return c.json({
          success: true,
          data: result,
        });
      }
    } catch (error) {
      // Minimal error logging for production speed
      return c.json({
        success: false,
        error: 'Failed to generate response',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  /**
   * Stream deployed agent response (real-time streaming)
   * POST /api/execute/agents/:agentId/stream
   */
  async streamAgent(c: Context): Promise<Response> {
    const { agentId } = c.req.param();
    
    try {
      const body = await c.req.json();
      const organizationId = this.getOrganizationId(c);
      
      // Single agent lookup - optimized for speed
      const agentBuilder = getAgentBuilder(organizationId);
      const agent = await agentBuilder.getAgent(agentId);
      
      if (!agent) {
        return c.json({
          success: false,
          error: 'Agent not found or not deployed',
        }, 404);
      }

      // Build options object only with defined values (same as execute endpoint)
      const options: any = {};
      
      // Memory options (only if needed)
      if (body.threadId || body.thread || body.resourceId || body.resource) {
        options.memory = {};
        if (body.threadId || body.thread) options.memory.thread = body.threadId || body.thread;
        if (body.resourceId || body.resource) options.memory.resource = body.resourceId || body.resource;
      }
      
      // Only add defined options (avoid undefined checks in Mastra)
      if (body.output !== undefined) options.output = body.output;
      if (body.maxSteps !== undefined) options.maxSteps = body.maxSteps;
      if (body.maxTokens !== undefined) options.maxTokens = body.maxTokens;
      if (body.temperature !== undefined) options.temperature = body.temperature;
      if (body.toolChoice !== undefined) options.toolChoice = body.toolChoice;
      if (body.structuredOutput !== undefined) options.structuredOutput = body.structuredOutput;
      if (body.providerOptions !== undefined) options.providerOptions = body.providerOptions;

      // Check if model supports streamVNext (V2) or use regular stream (V1)
      let stream;
      try {
        // Try streamVNext first (for V2 models)
        stream = await agent.streamVNext(body.messages || body.prompt || body.message, options);
      } catch (error) {
        // If streamVNext fails (V1 model), fall back to regular stream
        if (error instanceof Error && error.message.includes('V1 models are not supported for streamVNext')) {
          stream = await agent.stream(body.messages || body.prompt || body.message, options);
        } else {
          throw error;
        }
      }
      
      // Check streaming format preference
      const format = body.format || 'sse'; // Default to Server-Sent Events
      
      if (format === 'json') {
        // JSON Lines streaming for easier client consumption
        const headers = new Headers({
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        const readable = new ReadableStream({
          async start(controller) {
            try {
              // Send initial event
              controller.enqueue(new TextEncoder().encode(JSON.stringify({
                type: 'start',
                success: true,
                agentId,
              }) + '\n'));

              // Stream text chunks (both stream() and streamVNext() have textStream)
              for await (const chunk of stream.textStream) {
                controller.enqueue(new TextEncoder().encode(JSON.stringify({
                  type: 'text-delta',
                  chunk,
                }) + '\n'));
              }

              // Send completion
              controller.enqueue(new TextEncoder().encode(JSON.stringify({
                type: 'finish',
                usage: await stream.usage,
                finishReason: await stream.finishReason,
              }) + '\n'));

              controller.close();
            } catch (error) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : 'Stream error',
              }) + '\n'));
              controller.close();
            }
          },
        });

        return new Response(readable, { headers });
      } else {
        // Server-Sent Events format (default)
        const headers = new Headers({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control',
        });

        const readable = new ReadableStream({
          async start(controller) {
            try {
              // Send initial success event
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                type: 'start',
                success: true,
                agentId,
              })}\n\n`));

              // Stream text chunks (both stream() and streamVNext() have textStream)
              for await (const chunk of stream.textStream) {
                const data = JSON.stringify({
                  type: 'text-delta',
                  chunk,
                });
                controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              }

              // Send final usage and completion info
              const finalData = JSON.stringify({
                type: 'finish',
                usage: await stream.usage,
                finishReason: await stream.finishReason,
              });
              controller.enqueue(new TextEncoder().encode(`data: ${finalData}\n\n`));

              controller.close();
            } catch (error) {
              const errorData = JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : 'Stream error',
              });
              controller.enqueue(new TextEncoder().encode(`data: ${errorData}\n\n`));
              controller.close();
            }
          },
        });

        return new Response(readable, { headers });
      }
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to start stream',
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
