import { registerApiRoute } from '@mastra/core/server';
import { Context } from 'hono';
import { AgentFlowAPI } from './agent-management';
import { DynamicAgentBuilder } from '../agents/dynamic-agent-builder';
import { DynamicToolBuilder, createDynamicToolBuilder } from '../tools/dynamic-tool-builder';
import { getAgentBuilder } from '../platform';
import { cacheManager, cacheKey, invalidateToolCache } from '../utils/cache';
import { deploymentAPI, fastExecutionAPI } from './deployment-routes';

/**
 * Consolidated AgentFlow Routes
 * 
 * This file combines all custom routes and built-in route mirrors
 * for the AgentFlow platform, eliminating redundancy and providing
 * a single source of truth for all API endpoints.
 */

// Cached tool builder factory to avoid repeated initialization
const toolBuilderCache = new Map<string, DynamicToolBuilder>();

async function getCachedToolBuilder(organizationId: string): Promise<DynamicToolBuilder> {
  const cacheKey = `tool-builder:${organizationId}`;
  
  // Check if we have a cached instance
  if (toolBuilderCache.has(cacheKey)) {
    return toolBuilderCache.get(cacheKey)!;
  }
  
  // Create new instance and initialize it
  const toolBuilder = createDynamicToolBuilder(organizationId);
  await toolBuilder.initialize();
  
  // Cache the initialized instance
  toolBuilderCache.set(cacheKey, toolBuilder);
  
  return toolBuilder;
}

// Function to invalidate tool builder cache when tools are modified
function invalidateToolBuilderCache(organizationId: string): void {
  const cacheKey = `tool-builder:${organizationId}`;
  toolBuilderCache.delete(cacheKey);
  invalidateToolCache(organizationId);
}

export function createAgentFlowRoutes(
  agentBuilder: DynamicAgentBuilder,
  toolBuilder: DynamicToolBuilder
) {
  const api = new AgentFlowAPI(agentBuilder, toolBuilder);

  return [
    // System Routes
    registerApiRoute('/agentflow/api', {
      method: 'GET',
      handler: async (c: Context) => {
        const mastra = c.get('mastra');
        return c.json({
          success: true,
          data: {
            status: 'healthy',
            platform: 'AgentFlow',
            version: '1.0.0',
            mastra: {
              agents: Object.keys(mastra.getAgents()).length,
              workflows: Object.keys(mastra.getWorkflows()).length,
              tools: Object.keys(mastra.getMCPServers() || {}).length,
            },
          },
        });
      },
      openapi: {
        summary: 'Get API status',
        description: 'Get the current status of the AgentFlow API',
        tags: ['AgentFlow - System'],
        responses: {
          '200': {
            description: 'API status retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string' },
                        platform: { type: 'string' },
                        version: { type: 'string' },
                        mastra: {
                          type: 'object',
                          properties: {
                            agents: { type: 'number' },
                            workflows: { type: 'number' },
                            tools: { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),

    // Health Check Route
    registerApiRoute('/agentflow/health', {
      method: 'GET',
      handler: async (c) => {
        return c.json({
          success: true,
          data: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            platform: 'AgentFlow',
            version: '1.0.0',
          },
        });
      },
      openapi: {
        summary: 'Health check',
        description: 'Check if the AgentFlow platform is healthy and running',
        tags: ['AgentFlow - Platform'],
        responses: {
          '200': {
            description: 'Platform is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                        timestamp: { type: 'string', format: 'date-time' },
                        platform: { type: 'string' },
                        version: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),

    // Platform Status Route
    registerApiRoute('/agentflow/status', {
      method: 'GET',
      handler: (c) => api.getPlatformStatus(c),
      openapi: {
        summary: 'Get platform status',
        description: 'Get the current status of the AgentFlow platform',
        tags: ['AgentFlow - Platform'],
        responses: {
          '200': {
            description: 'Platform status retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        platform: { type: 'string' },
                        version: { type: 'string' },
                        status: { type: 'string' },
                        agents: {
                          type: 'object',
                          properties: {
                            total: { type: 'number' },
                            active: { type: 'number' },
                            inactive: { type: 'number' },
                          },
                        },
                        tools: {
                          type: 'object',
                          properties: {
                            total: { type: 'number' },
                            active: { type: 'number' },
                            inactive: { type: 'number' },
                          },
                        },
                        uptime: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    // Database Status Route
    registerApiRoute('/agentflow/database/status', {
      method: 'GET',
      handler: async (c) => {
        const mastra = c.get('mastra');
        try {
          const storage = mastra.getStorage();
          return c.json({
            success: true,
            data: {
              status: 'connected',
              type: storage ? 'configured' : 'not configured',
              timestamp: new Date().toISOString(),
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            data: {
              status: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
              timestamp: new Date().toISOString(),
            },
          }, 500);
        }
      },
      openapi: {
        summary: 'Get database status',
        description: 'Check the connection status and configuration of the database',
        tags: ['AgentFlow - Platform'],
        responses: {
          '200': {
            description: 'Database status retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', enum: ['connected', 'disconnected', 'error'] },
                        type: { type: 'string', description: 'Database type or configuration status' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': {
            description: 'Database connection error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string' },
                        error: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),

    // Platform Statistics Route
    registerApiRoute('/agentflow/statistics', {
      method: 'GET',
      handler: async (c) => {
        try {
          const agents = await agentBuilder.listAgents();
          const tools = toolBuilder.listTools();
          
          const statistics = {
            agents: {
              total: agents.length,
              byStatus: agents.reduce((acc, agent) => {
                acc[agent.status] = (acc[agent.status] || 0) + 1;
                return acc;
              }, {} as Record<string, number>),
              byModel: agents.reduce((acc, agent) => {
                const model = typeof agent.model === 'string' ? agent.model : 'dynamic';
                acc[model] = (acc[model] || 0) + 1;
                return acc;
              }, {} as Record<string, number>),
            },
            tools: {
              total: tools.length,
              byStatus: tools.reduce((acc, tool) => {
                acc[tool.status] = (acc[tool.status] || 0) + 1;
                return acc;
              }, {} as Record<string, number>),
            },
            platform: {
              uptime: process.uptime(),
              memoryUsage: process.memoryUsage(),
              nodeVersion: process.version,
            },
          };

          return c.json({
            success: true,
            data: statistics,
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to get statistics',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Get platform statistics',
        description: 'Get detailed statistics about agents, tools, and platform performance',
        tags: ['AgentFlow - Platform'],
        responses: {
          '200': {
            description: 'Statistics retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        agents: {
                          type: 'object',
                          properties: {
                            total: { type: 'number' },
                            byStatus: { type: 'object', additionalProperties: { type: 'number' } },
                            byModel: { type: 'object', additionalProperties: { type: 'number' } },
                          },
                        },
                        tools: {
                          type: 'object',
                          properties: {
                            total: { type: 'number' },
                            byStatus: { type: 'object', additionalProperties: { type: 'number' } },
                          },
                        },
                        platform: {
                          type: 'object',
                          properties: {
                            uptime: { type: 'number' },
                            memoryUsage: {
                              type: 'object',
                              properties: {
                                rss: { type: 'number' },
                                heapTotal: { type: 'number' },
                                heapUsed: { type: 'number' },
                                external: { type: 'number' },
                              },
                            },
                            nodeVersion: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    // Agent Routes - Combined built-in mirrors and custom functionality
    registerApiRoute('/agentflow/api/agents', {
      method: 'GET',
      handler: async (c: Context) => {
        try {
          const organizationId = c.req.query('organizationId') || 'default';
          const agentBuilder = getAgentBuilder(organizationId);
          const agentConfigs = await agentBuilder.listAgents();
          
          const agentList = agentConfigs.map(config => ({
            id: config.id,
            name: config.name,
            description: config.description,
            instructions: config.instructions,
            model: config.model,
            tools: config.tools,
            status: config.status,
            createdAt: config.createdAt,
            updatedAt: config.updatedAt,
          }));

          return c.json({
            success: true,
            data: agentList,
            meta: {
              organizationId,
              count: agentList.length,
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to load agents',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'List all agents',
        description: 'Get a list of all registered agents in the system',
        tags: ['AgentFlow - Agents'],
        responses: {
          '200': {
            description: 'Agents retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          instructions: { type: 'string' },
                          model: { type: 'string' },
                          tools: { type: 'array', items: { type: 'string' } },
                          status: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents', {
      method: 'POST',
      handler: (c) => api.createAgent(c),
      openapi: {
        summary: 'Create a new agent',
        description: 'Create a new agent with the specified configuration',
        tags: ['AgentFlow - Agents'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Unique agent identifier' },
                  name: { type: 'string', description: 'Agent name' },
                  description: { type: 'string', description: 'Agent description' },
                  instructions: { type: 'string', description: 'Agent instructions' },
                  model: { type: 'string', description: 'Model to use' },
                  tools: { type: 'array', items: { type: 'string' }, description: 'List of tool IDs' },
                  status: { type: 'string', enum: ['active', 'inactive'], description: 'Agent status' },
                },
                required: ['id', 'name', 'instructions', 'model'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Agent created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        status: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation failed' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents/:agentId', {
      method: 'GET',
      handler: async (c: Context) => {
        const { agentId } = c.req.param();
        
        try {
          const organizationId = c.req.query('organizationId') || 'default';
          const agentBuilder = getAgentBuilder(organizationId);
          const agent = await agentBuilder.getAgent(agentId);
          
          if (!agent) {
            return c.json({
              success: false,
              error: 'Agent not found',
              details: `Agent with ID '${agentId}' not found in organization '${organizationId}'`,
            }, 404);
          }

          const agentConfigs = await agentBuilder.listAgents();
          const agentConfig = agentConfigs.find(config => config.id === agentId);
          
          return c.json({
            success: true,
            data: {
              id: agentId,
              name: agent.name || agentId,
              description: agent.getDescription() || '',
              instructions: await agent.getInstructions() || '',
              model: agentConfig?.model || 'unknown',
              tools: agentConfig?.tools || [],
              status: agentConfig?.status || 'active',
              createdAt: agentConfig?.createdAt,
              updatedAt: agentConfig?.updatedAt,
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to load agent',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Get agent by ID',
        description: 'Get details of a specific agent by its ID',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The ID of the agent to retrieve',
          },
        ],
        responses: {
          '200': {
            description: 'Agent retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        instructions: { type: 'string' },
                        model: { type: 'string' },
                        tools: { type: 'array', items: { type: 'string' } },
                        status: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Agent not found' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents/:agentId', {
      method: 'PUT',
      handler: (c) => api.updateAgent(c),
      openapi: {
        summary: 'Update an agent',
        description: 'Update an existing agent with new configuration',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Agent ID to update',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Agent name' },
                  description: { type: 'string', description: 'Agent description' },
                  instructions: { type: 'string', description: 'Agent instructions' },
                  model: { type: 'string', description: 'Model to use' },
                  tools: { type: 'array', items: { type: 'string' }, description: 'List of tool IDs' },
                  status: { type: 'string', enum: ['active', 'inactive'], description: 'Agent status' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Agent updated successfully' },
          '404': { description: 'Agent not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents/:agentId', {
      method: 'PATCH',
      handler: (c) => api.patchAgent(c),
      openapi: {
        summary: 'Partially update an agent',
        description: 'Partially update an existing agent with only the provided fields',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Agent ID to partially update',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Agent name' },
                  description: { type: 'string', description: 'Agent description' },
                  instructions: { type: 'string', description: 'Agent instructions' },
                  model: { type: 'string', description: 'Model to use' },
                  tools: { type: 'array', items: { type: 'string' }, description: 'List of tool IDs' },
                  status: { type: 'string', enum: ['active', 'inactive'], description: 'Agent status' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Agent partially updated successfully' },
          '404': { description: 'Agent not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents/:agentId', {
      method: 'DELETE',
      handler: (c) => api.deleteAgent(c),
      openapi: {
        summary: 'Delete an agent',
        description: 'Delete an existing agent',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Agent ID to delete',
          },
        ],
        responses: {
          '200': { description: 'Agent deleted successfully' },
          '404': { description: 'Agent not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    // Agent Generation and Streaming Routes
    registerApiRoute('/agentflow/api/agents/:agentId/generate', {
      method: 'POST',
      handler: async (c: Context) => {
        const { agentId } = c.req.param();
        
        try {
          const body = await c.req.json();
          const organizationId = c.req.query('organizationId') || 'default';
          const agentBuilder = getAgentBuilder(organizationId);
          const agent = await agentBuilder.getAgent(agentId);
          
          if (!agent) {
            return c.json({
              success: false,
              error: 'Agent not found',
              details: `Agent with ID '${agentId}' not found in organization '${organizationId}'`,
            }, 404);
          }
          
          const memoryOptions: any = {};
          if (body.threadId || body.thread) {
            memoryOptions.thread = body.threadId || body.thread;
          }
          if (body.resourceId || body.resource) {
            memoryOptions.resource = body.resourceId || body.resource;
          }
          
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
          return c.json({
            success: false,
            error: 'Failed to generate response',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Generate response from agent',
        description: 'Send a prompt to an agent and get its response',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The ID of the agent to use',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  messages: { type: 'array', items: { type: 'string' }, description: 'Array of messages' },
                  prompt: { type: 'string', description: 'Single prompt string' },
                  message: { type: 'string', description: 'Single message string' },
                  output: { type: 'object', description: 'Output schema' },
                  maxSteps: { type: 'number', description: 'Maximum steps' },
                  maxTokens: { type: 'number', description: 'Maximum tokens' },
                  temperature: { type: 'number', description: 'Temperature setting' },
                  topP: { type: 'number', description: 'Top-p setting' },
                  threadId: { type: 'string', description: 'Thread ID for memory (alternative to thread)' },
                  thread: { type: 'string', description: 'Thread ID for memory' },
                  resourceId: { type: 'string', description: 'Resource ID for memory (alternative to resource)' },
                  resource: { type: 'string', description: 'Resource ID for memory' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Response generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        agentId: { type: 'string' },
                        result: { type: 'object' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Agent not found' },
          '500': { description: 'Generation failed' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents/:agentId/stream', {
      method: 'POST',
      handler: async (c: Context) => {
        const { agentId } = c.req.param();
        
        try {
          const body = await c.req.json();
          const organizationId = c.req.query('organizationId') || 'default';
          const agentBuilder = getAgentBuilder(organizationId);
          const agent = await agentBuilder.getAgent(agentId);
          
          if (!agent) {
            return c.json({
              success: false,
              error: 'Agent not found',
              details: `Agent with ID '${agentId}' not found in organization '${organizationId}'`,
            }, 404);
          }
          
          const memoryOptions: any = {};
          if (body.threadId || body.thread) {
            memoryOptions.thread = body.threadId || body.thread;
          }
          if (body.resourceId || body.resource) {
            memoryOptions.resource = body.resourceId || body.resource;
          }
          
          const streamResult = await agent.stream(body.messages || body.prompt || body.message, {
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

          const fullStream = await streamResult.fullStream;

          return new Response(fullStream, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Transfer-Encoding': 'chunked',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to stream response',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Stream response from agent',
        description: 'Stream a response from an agent in real-time',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The ID of the agent to use',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  messages: { type: 'array', items: { type: 'string' }, description: 'Array of messages' },
                  prompt: { type: 'string', description: 'Single prompt string' },
                  message: { type: 'string', description: 'Single message string' },
                  output: { type: 'object', description: 'Output schema' },
                  maxSteps: { type: 'number', description: 'Maximum steps' },
                  maxTokens: { type: 'number', description: 'Maximum tokens' },
                  temperature: { type: 'number', description: 'Temperature setting' },
                  topP: { type: 'number', description: 'Top-p setting' },
                  threadId: { type: 'string', description: 'Thread ID for memory (alternative to thread)' },
                  thread: { type: 'string', description: 'Thread ID for memory' },
                  resourceId: { type: 'string', description: 'Resource ID for memory (alternative to resource)' },
                  resource: { type: 'string', description: 'Resource ID for memory' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Stream started successfully',
            content: {
              'text/plain': {
                schema: { type: 'string' },
              },
            },
          },
          '404': { description: 'Agent not found' },
          '500': { description: 'Stream failed' },
        },
      },
    }),

    // Advanced Agent Features
    registerApiRoute('/agentflow/api/agents/:agentId/configuration', {
      method: 'GET',
      handler: (c) => api.getAgentConfiguration(c),
      openapi: {
        summary: 'Get agent configuration',
        description: 'Get the full configuration of an agent',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Agent ID to get configuration for',
          },
        ],
        responses: {
          '200': {
            description: 'Agent configuration retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        instructions: { type: 'string' },
                        model: { type: 'string' },
                        tools: { type: 'array', items: { type: 'string' } },
                        memory: { type: 'object' },
                        voice: { type: 'object' },
                        status: { type: 'string' },
                        metadata: { type: 'object' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Agent not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents/:agentId/tools', {
      method: 'GET',
      handler: (c) => api.getAgentTools(c),
      openapi: {
        summary: 'Get agent tools',
        description: 'Get all tools associated with an agent',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Agent ID to get tools for',
          },
        ],
        responses: {
          '200': {
            description: 'Agent tools retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          status: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Agent not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents/:agentId/analytics', {
      method: 'GET',
      handler: (c) => api.getAgentAnalytics(c),
      openapi: {
        summary: 'Get agent analytics',
        description: 'Get analytics and metrics for an agent',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Agent ID to get analytics for',
          },
          {
            name: 'startDate',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'date' },
            description: 'Start date for analytics period',
          },
          {
            name: 'endDate',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'date' },
            description: 'End date for analytics period',
          },
        ],
        responses: {
          '200': {
            description: 'Agent analytics retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        agentId: { type: 'string' },
                        period: {
                          type: 'object',
                          properties: {
                            startDate: { type: 'string' },
                            endDate: { type: 'string' },
                          },
                        },
                        metrics: {
                          type: 'object',
                          properties: {
                            totalRequests: { type: 'number' },
                            averageResponseTime: { type: 'number' },
                            successRate: { type: 'number' },
                            errorRate: { type: 'number' },
                            tokenUsage: {
                              type: 'object',
                              properties: {
                                input: { type: 'number' },
                                output: { type: 'number' },
                                total: { type: 'number' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Agent not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/agents/:agentId/tools/:toolId/execute', {
      method: 'POST',
      handler: async (c: Context) => {
        const { agentId, toolId } = c.req.param();
        
        try {
          const body = await c.req.json();
          const organizationId = c.req.query('organizationId') || 'default';
          const agentBuilder = getAgentBuilder(organizationId);
          const agent = await agentBuilder.getAgent(agentId);
          
          if (!agent) {
            return c.json({
              success: false,
              error: 'Agent not found',
              details: `Agent with ID '${agentId}' not found in organization '${organizationId}'`,
            }, 404);
          }
          
          const result = await agent.generate(`Execute tool ${toolId} with parameters: ${JSON.stringify(body)}`, {
            maxSteps: 1,
          });

          return c.json({
            success: true,
            data: {
              agentId,
              organizationId,
              toolId,
              result,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to execute tool',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Execute tool through agent',
        description: 'Execute a specific tool through an agent',
        tags: ['AgentFlow - Agents'],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The ID of the agent to use',
          },
          {
            name: 'toolId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The ID of the tool to execute',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Tool execution parameters',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tool executed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        agentId: { type: 'string' },
                        toolId: { type: 'string' },
                        result: { type: 'object' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Agent or tool not found' },
          '500': { description: 'Tool execution failed' },
        },
      },
    }),

    // Tool Routes - Combined built-in mirrors and custom functionality
    registerApiRoute('/agentflow/api/tools', {
      method: 'GET',
      handler: async (c: Context) => {
        try {
          const organizationId = c.req.query('organizationId') || 'default';
          const toolBuilder = await getCachedToolBuilder(organizationId);
          
          const tools = toolBuilder.listTools();
          
          const toolList = tools.map(tool => ({
            id: tool.id,
            name: tool.name,
            description: tool.description,
            status: tool.status,
            apiEndpoint: tool.apiEndpoint,
            method: tool.method,
            createdAt: tool.createdAt,
            updatedAt: tool.updatedAt,
          }));

          return c.json({
            success: true,
            data: toolList,
            meta: {
              organizationId,
              count: toolList.length,
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to load tools',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'List all tools',
        description: 'Get a list of all registered tools in the system',
        tags: ['AgentFlow - Tools'],
        responses: {
          '200': {
            description: 'Tools retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          status: { type: 'string' },
                          apiEndpoint: { type: 'string' },
                          method: { type: 'string' },
                          createdAt: { type: 'string', format: 'date-time' },
                          updatedAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        organizationId: { type: 'string' },
                        count: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/tools', {
      method: 'POST',
      handler: async (c) => {
        const result = await api.createTool(c);
        
        // If tool creation was successful, invalidate the cache
        if (result.status === 201) {
          const organizationId = c.req.query('organizationId') || 'default';
          invalidateToolBuilderCache(organizationId);
        }
        
        return result;
      },
      openapi: {
        summary: 'Create a new tool',
        description: 'Create a new tool with the specified configuration',
        tags: ['AgentFlow - Tools'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Unique tool identifier' },
                  name: { type: 'string', description: 'Tool name' },
                  description: { type: 'string', description: 'Tool description' },
                  inputSchema: { type: 'object', description: 'Input schema definition' },
                  outputSchema: { type: 'object', description: 'Output schema definition' },
                  apiEndpoint: { type: 'string', description: 'API endpoint URL' },
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method' },
                  contentType: { type: 'string', enum: ['application/json', 'application/x-www-form-urlencoded', 'text/plain', 'text/xml', 'application/xml'], description: 'Content type for request body' },
                  bodyFormat: { type: 'string', enum: ['json', 'form', 'text', 'xml'], description: 'Body format for request' },
                  headers: { type: 'object', description: 'Request headers' },
                  authentication: { type: 'object', description: 'Authentication configuration' },
                  rateLimit: { type: 'object', description: 'Rate limiting configuration' },
                  timeout: { type: 'number', description: 'Request timeout in milliseconds' },
                  retries: { type: 'number', description: 'Number of retry attempts' },
                  cache: { type: 'object', description: 'Caching configuration' },
                  validation: { type: 'object', description: 'Validation configuration' },
                  status: { type: 'string', enum: ['active', 'inactive'], description: 'Tool status' },
                },
                required: ['id', 'name', 'description', 'apiEndpoint', 'method'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Tool created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        status: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation failed' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/tools/:toolId', {
      method: 'GET',
      handler: async (c: Context) => {
        const { toolId } = c.req.param();
        
        try {
          const organizationId = c.req.query('organizationId') || 'default';
          const toolBuilder = await getCachedToolBuilder(organizationId);
          
          const tool = toolBuilder.getTool(toolId);
          
          if (!tool) {
            return c.json({
              success: false,
              error: 'Tool not found',
              details: `Tool with ID '${toolId}' not found in organization '${organizationId}'`,
            }, 404);
          }

          const tools = toolBuilder.listTools();
          const toolConfig = tools.find(config => config.id === toolId);
          
          return c.json({
            success: true,
            data: {
              id: toolId,
              name: toolConfig?.name || toolId,
              description: toolConfig?.description || '',
              status: toolConfig?.status || 'active',
              apiEndpoint: toolConfig?.apiEndpoint,
              method: toolConfig?.method,
              inputSchema: toolConfig?.inputSchema,
              outputSchema: toolConfig?.outputSchema,
              headers: toolConfig?.headers,
              authentication: toolConfig?.authentication,
              rateLimit: toolConfig?.rateLimit,
              timeout: toolConfig?.timeout,
              retries: toolConfig?.retries,
              cache: toolConfig?.cache,
              validation: toolConfig?.validation,
              metadata: toolConfig?.metadata,
              createdAt: toolConfig?.createdAt,
              updatedAt: toolConfig?.updatedAt,
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to load tool',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Get tool by ID',
        description: 'Get details of a specific tool by its ID',
        tags: ['AgentFlow - Tools'],
        parameters: [
          {
            name: 'toolId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The ID of the tool to retrieve',
          },
        ],
        responses: {
          '200': {
            description: 'Tool retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        status: { type: 'string' },
                        apiEndpoint: { type: 'string' },
                        method: { type: 'string' },
                        inputSchema: { type: 'object' },
                        outputSchema: { type: 'object' },
                        headers: { type: 'object' },
                        authentication: { type: 'object' },
                        rateLimit: { type: 'object' },
                        timeout: { type: 'number' },
                        retries: { type: 'number' },
                        cache: { type: 'object' },
                        validation: { type: 'object' },
                        metadata: { type: 'object' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Tool not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/tools/:toolId', {
      method: 'PUT',
      handler: async (c) => {
        const result = await api.updateTool(c);
        
        // If tool update was successful, invalidate the cache
        if (result.status === 200) {
          const organizationId = c.req.query('organizationId') || 'default';
          invalidateToolBuilderCache(organizationId);
        }
        
        return result;
      },
      openapi: {
        summary: 'Update a tool',
        description: 'Update an existing tool with new configuration',
        tags: ['AgentFlow - Tools'],
        parameters: [
          {
            name: 'toolId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Tool ID to update',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Tool name' },
                  description: { type: 'string', description: 'Tool description' },
                  inputSchema: { type: 'object', description: 'Input schema definition' },
                  outputSchema: { type: 'object', description: 'Output schema definition' },
                  apiEndpoint: { type: 'string', description: 'API endpoint URL' },
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method' },
                  contentType: { type: 'string', enum: ['application/json', 'application/x-www-form-urlencoded', 'text/plain', 'text/xml', 'application/xml'], description: 'Content type for request body' },
                  bodyFormat: { type: 'string', enum: ['json', 'form', 'text', 'xml'], description: 'Body format for request' },
                  headers: { type: 'object', description: 'Request headers' },
                  authentication: { type: 'object', description: 'Authentication configuration' },
                  rateLimit: { type: 'object', description: 'Rate limiting configuration' },
                  timeout: { type: 'number', description: 'Request timeout in milliseconds' },
                  retries: { type: 'number', description: 'Number of retry attempts' },
                  cache: { type: 'object', description: 'Caching configuration' },
                  validation: { type: 'object', description: 'Validation configuration' },
                  status: { type: 'string', enum: ['active', 'inactive'], description: 'Tool status' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Tool updated successfully' },
          '404': { description: 'Tool not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/tools/:toolId', {
      method: 'PATCH',
      handler: async (c) => {
        const result = await api.patchTool(c);
        
        // If tool patch was successful, invalidate the cache
        if (result.status === 200) {
          const organizationId = c.req.query('organizationId') || 'default';
          invalidateToolBuilderCache(organizationId);
        }
        
        return result;
      },
      openapi: {
        summary: 'Partially update a tool',
        description: 'Partially update an existing tool with only the provided fields',
        tags: ['AgentFlow - Tools'],
        parameters: [
          {
            name: 'toolId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Tool ID to partially update',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Tool name' },
                  description: { type: 'string', description: 'Tool description' },
                  inputSchema: { type: 'object', description: 'Input schema definition' },
                  outputSchema: { type: 'object', description: 'Output schema definition' },
                  apiEndpoint: { type: 'string', description: 'API endpoint URL' },
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method' },
                  contentType: { type: 'string', enum: ['application/json', 'application/x-www-form-urlencoded', 'text/plain', 'text/xml', 'application/xml'], description: 'Content type for request body' },
                  bodyFormat: { type: 'string', enum: ['json', 'form', 'text', 'xml'], description: 'Body format for request' },
                  headers: { type: 'object', description: 'Request headers' },
                  authentication: { type: 'object', description: 'Authentication configuration' },
                  rateLimit: { type: 'object', description: 'Rate limiting configuration' },
                  timeout: { type: 'number', description: 'Request timeout in milliseconds' },
                  retries: { type: 'number', description: 'Number of retry attempts' },
                  cache: { type: 'object', description: 'Caching configuration' },
                  validation: { type: 'object', description: 'Validation configuration' },
                  status: { type: 'string', enum: ['active', 'inactive'], description: 'Tool status' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Tool partially updated successfully' },
          '404': { description: 'Tool not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/tools/:toolId', {
      method: 'DELETE',
      handler: async (c) => {
        const result = await api.deleteTool(c);
        
        // If tool deletion was successful, invalidate the cache
        if (result.status === 200) {
          const organizationId = c.req.query('organizationId') || 'default';
          invalidateToolBuilderCache(organizationId);
        }
        
        return result;
      },
      openapi: {
        summary: 'Delete a tool',
        description: 'Delete an existing tool',
        tags: ['AgentFlow - Tools'],
        parameters: [
          {
            name: 'toolId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Tool ID to delete',
          },
        ],
        responses: {
          '200': { description: 'Tool deleted successfully' },
          '404': { description: 'Tool not found' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/tools/:toolId/execute', {
      method: 'POST',
      handler: async (c: Context) => {
        const { toolId } = c.req.param();
        
        try {
          const body = await c.req.json();
          const organizationId = c.req.query('organizationId') || 'default';
          const toolBuilder = await getCachedToolBuilder(organizationId);
          
          const tool = toolBuilder.getTool(toolId);
          
          if (!tool) {
            return c.json({
              success: false,
              error: 'Tool not found',
              details: `Tool with ID '${toolId}' not found in organization '${organizationId}'`,
            }, 404);
          }

          // Execute the tool with the provided input
          const result = await tool.execute({
            context: body,
            runtimeContext: {
              organizationId,
              userId: body.userId || 'anonymous',
              requestId: body.requestId || `req_${Date.now()}`,
            },
          });

          return c.json({
            success: true,
            data: {
              toolId,
              organizationId,
              input: body,
              output: result,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to execute tool',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Execute tool directly',
        description: 'Execute a specific tool with the provided parameters',
        tags: ['AgentFlow - Tools'],
        parameters: [
          {
            name: 'toolId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The ID of the tool to execute',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Tool execution parameters',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tool executed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        toolId: { type: 'string' },
                        organizationId: { type: 'string' },
                        input: { type: 'object' },
                        output: { type: 'object' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Tool not found' },
          '500': { description: 'Tool execution failed' },
        },
      },
    }),

    // Tool Health Check Routes
    registerApiRoute('/agentflow/api/tools/:toolId/health', {
      method: 'GET',
      handler: async (c: Context) => {
        const { toolId } = c.req.param();
        const organizationId = c.req.query('organizationId') || 'default';
        
        try {
          const toolBuilder = await getCachedToolBuilder(organizationId);
          
          const healthResult = await toolBuilder.healthCheck(toolId);

          return c.json({
            success: true,
            data: {
              toolId,
              organizationId,
              ...healthResult,
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to perform health check',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Check tool health',
        description: 'Perform a health check on a specific tool to verify its API connectivity and status',
        tags: ['AgentFlow - Tools'],
        parameters: [
          {
            name: 'toolId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The ID of the tool to check',
          },
        ],
        responses: {
          '200': {
            description: 'Health check completed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        toolId: { type: 'string' },
                        organizationId: { type: 'string' },
                        healthy: { type: 'boolean' },
                        status: { type: 'string' },
                        responseTime: { type: 'number' },
                        error: { type: 'string' },
                        lastChecked: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Health check failed' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/tools/health', {
      method: 'GET',
      handler: async (c: Context) => {
        const organizationId = c.req.query('organizationId') || 'default';
        
        try {
          const toolBuilder = await getCachedToolBuilder(organizationId);
          
          const healthResults = await toolBuilder.healthCheckAll();

          const summary = {
            total: Object.keys(healthResults).length,
            healthy: Object.values(healthResults).filter((r: any) => r.healthy).length,
            unhealthy: Object.values(healthResults).filter((r: any) => !r.healthy).length,
            averageResponseTime: Object.values(healthResults)
              .filter((r: any) => r.responseTime)
              .reduce((sum: number, r: any) => sum + r.responseTime, 0) / 
              Object.values(healthResults).filter((r: any) => r.responseTime).length || 0,
          };

          return c.json({
            success: true,
            data: {
              organizationId,
              summary,
              tools: healthResults,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to perform health checks',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Check all tools health',
        description: 'Perform health checks on all tools in the organization to get an overview of tool status',
        tags: ['AgentFlow - Tools'],
        responses: {
          '200': {
            description: 'Health checks completed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        organizationId: { type: 'string' },
                        summary: {
                          type: 'object',
                          properties: {
                            total: { type: 'number' },
                            healthy: { type: 'number' },
                            unhealthy: { type: 'number' },
                            averageResponseTime: { type: 'number' },
                          },
                        },
                        tools: {
                          type: 'object',
                          additionalProperties: {
                            type: 'object',
                            properties: {
                              healthy: { type: 'boolean' },
                              status: { type: 'string' },
                              responseTime: { type: 'number' },
                              error: { type: 'string' },
                              lastChecked: { type: 'string', format: 'date-time' },
                            },
                          },
                        },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Health checks failed' },
        },
      },
    }),

    // Tool Templates and Advanced Features
    registerApiRoute('/agentflow/api/tools/templates', {
      method: 'GET',
      handler: (c) => api.getToolTemplates(c),
      openapi: {
        summary: 'Get tool templates',
        description: 'Get all available tool templates for creating new tools',
        tags: ['AgentFlow - Tools'],
        responses: {
          '200': {
            description: 'Tool templates retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          category: { type: 'string' },
                          schema: { type: 'object' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/tools/from-template', {
      method: 'POST',
      handler: (c) => api.createToolFromTemplate(c),
      openapi: {
        summary: 'Create tool from template',
        description: 'Create a new tool using a predefined template with customizations',
        tags: ['AgentFlow - Tools'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  templateId: { type: 'string', description: 'Template ID to use' },
                  customizations: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', description: 'Unique tool identifier' },
                      name: { type: 'string', description: 'Tool name' },
                      description: { type: 'string', description: 'Tool description' },
                      apiEndpoint: { type: 'string', description: 'API endpoint URL' },
                      authentication: { type: 'object', description: 'Authentication configuration' },
                    },
                    required: ['id', 'name'],
                  },
                },
                required: ['templateId', 'customizations'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Tool created from template successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        templateId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation failed' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    // Bulk Operations Route
    registerApiRoute('/agentflow/api/bulk/agents', {
      method: 'POST',
      handler: async (c) => {
        try {
          const { operation, agentIds, data } = await c.req.json();
          
          const results: Array<{
            agentId: string;
            success: boolean;
            result?: any;
            error?: string;
          }> = [];
          for (const agentId of agentIds) {
            try {
              let result;
              switch (operation) {
                case 'update':
                  result = agentBuilder.updateAgent(agentId, data);
                  break;
                case 'delete':
                  result = agentBuilder.deleteAgent(agentId);
                  break;
                default:
                  throw new Error(`Unknown operation: ${operation}`);
              }
              results.push({ agentId, success: true, result });
            } catch (error) {
              results.push({ 
                agentId, 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
              });
            }
          }

          return c.json({
            success: true,
            data: {
              operation,
              totalProcessed: agentIds.length,
              successful: results.filter(r => r.success).length,
              failed: results.filter(r => !r.success).length,
              results,
            },
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to perform bulk operation',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Bulk agent operations',
        description: 'Perform bulk operations on multiple agents (update, delete)',
        tags: ['AgentFlow - Agents'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  operation: { 
                    type: 'string', 
                    enum: ['update', 'delete'], 
                    description: 'Operation to perform on agents' 
                  },
                  agentIds: { 
                    type: 'array', 
                    items: { type: 'string' }, 
                    description: 'Array of agent IDs to process' 
                  },
                  data: { 
                    type: 'object', 
                    description: 'Data to use for update operations (ignored for delete)' 
                  },
                },
                required: ['operation', 'agentIds'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Bulk operation completed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        operation: { type: 'string' },
                        totalProcessed: { type: 'number' },
                        successful: { type: 'number' },
                        failed: { type: 'number' },
                        results: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              agentId: { type: 'string' },
                              success: { type: 'boolean' },
                              result: { type: 'object' },
                              error: { type: 'string' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid request data' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    // Export/Import Routes
    registerApiRoute('/agentflow/api/export/agents', {
      method: 'GET',
      handler: async (c) => {
        try {
          const agents = await agentBuilder.listAgents();
          const exportData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            agents: agents.map(agent => ({
              id: agent.id,
              name: agent.name,
              description: agent.description,
              instructions: agent.instructions,
              model: agent.model,
              tools: agent.tools,
              memory: agent.memory,
              voice: agent.voice,
              status: agent.status,
              metadata: agent.metadata,
            })),
          };

          return c.json({
            success: true,
            data: exportData,
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to export agents',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Export agents',
        description: 'Export all agents configuration data for backup or migration',
        tags: ['AgentFlow - Export/Import'],
        responses: {
          '200': {
            description: 'Agents exported successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        version: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                        agents: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              name: { type: 'string' },
                              description: { type: 'string' },
                              instructions: { type: 'string' },
                              model: { type: 'string' },
                              tools: { type: 'array', items: { type: 'string' } },
                              memory: { type: 'object' },
                              voice: { type: 'object' },
                              status: { type: 'string' },
                              metadata: { type: 'object' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Export failed' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/export/tools', {
      method: 'GET',
      handler: async (c) => {
        try {
          const tools = toolBuilder.listTools();
          const exportData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            tools: tools.map(tool => ({
              id: tool.id,
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema,
              apiEndpoint: tool.apiEndpoint,
              method: tool.method,
              headers: tool.headers,
              authentication: tool.authentication,
              rateLimit: tool.rateLimit,
              timeout: tool.timeout,
              retries: tool.retries,
              cache: tool.cache,
              validation: tool.validation,
              status: tool.status,
              metadata: tool.metadata,
            })),
          };

          return c.json({
            success: true,
            data: exportData,
          });
        } catch (error) {
          return c.json({
            success: false,
            error: 'Failed to export tools',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
      openapi: {
        summary: 'Export tools',
        description: 'Export all tools configuration data for backup or migration',
        tags: ['AgentFlow - Export/Import'],
        responses: {
          '200': {
            description: 'Tools exported successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        version: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                        tools: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              name: { type: 'string' },
                              description: { type: 'string' },
                              inputSchema: { type: 'object' },
                              outputSchema: { type: 'object' },
                              apiEndpoint: { type: 'string' },
                              method: { type: 'string' },
                              headers: { type: 'object' },
                              authentication: { type: 'object' },
                              rateLimit: { type: 'object' },
                              timeout: { type: 'number' },
                              retries: { type: 'number' },
                              cache: { type: 'object' },
                              validation: { type: 'object' },
                              status: { type: 'string' },
                              metadata: { type: 'object' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Export failed' },
        },
      },
    }),

    // Deployment Routes (appear in Swagger)
    registerApiRoute('/agentflow/api/deploy/agents/:agentId', {
      method: 'POST',
      handler: (c) => deploymentAPI.deployAgent(c),
      openapi: {
        summary: 'Deploy agent for fast execution',
        description: 'Pre-resolve and store an agent configuration for fast runtime execution.',
        tags: ['AgentFlow - Deployment'],
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '201': { description: 'Agent deployed successfully' },
          '400': { description: 'Validation failed' },
          '500': { description: 'Internal server error' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/deploy/agents/:agentId', {
      method: 'DELETE',
      handler: (c) => deploymentAPI.undeployAgent(c),
      openapi: {
        summary: 'Undeploy agent',
        description: 'Remove an agent from fast execution state.',
        tags: ['AgentFlow - Deployment'],
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Agent undeployed' },
          '404': { description: 'Agent not found' },
        },
      },
    }),

    registerApiRoute('/agentflow/api/deploy/agents', {
      method: 'GET',
      handler: (c) => deploymentAPI.listDeployedAgents(c),
      openapi: {
        summary: 'List deployed agents',
        tags: ['AgentFlow - Deployment'],
        responses: { '200': { description: 'OK' } },
      },
    }),

    registerApiRoute('/agentflow/api/deploy/agents/:agentId/status', {
      method: 'GET',
      handler: (c) => deploymentAPI.getAgentDeploymentStatus(c),
      openapi: {
        summary: 'Get agent deployment status',
        tags: ['AgentFlow - Deployment'],
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    }),


    // Fast Execution Routes (appear in Swagger)
    registerApiRoute('/agentflow/api/execute/agents/:agentId', {
      method: 'POST',
      handler: (c) => fastExecutionAPI.executeAgent(c),
      openapi: {
        summary: 'Execute deployed agent',
        description: 'Execute a pre-deployed agent with the same interface as the regular generate endpoint, but with optimized performance.',
        tags: ['AgentFlow - Execution'],
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  messages: { type: 'array', items: { type: 'string' }, description: 'Array of messages' },
                  prompt: { type: 'string', description: 'Single prompt string' },
                  message: { type: 'string', description: 'Single message string' },
                  output: { type: 'object', description: 'Output schema' },
                  maxSteps: { type: 'number', description: 'Maximum steps' },
                  maxTokens: { type: 'number', description: 'Maximum tokens' },
                  temperature: { type: 'number', description: 'Temperature setting' },
                  topP: { type: 'number', description: 'Top-p setting' },
                  threadId: { type: 'string', description: 'Thread ID for memory (alternative to thread)' },
                  thread: { type: 'string', description: 'Thread ID for memory' },
                  resourceId: { type: 'string', description: 'Resource ID for memory (alternative to resource)' },
                  resource: { type: 'string', description: 'Resource ID for memory' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Response generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        agentId: { type: 'string' },
                        result: { type: 'object' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Agent not found' },
          '500': { description: 'Execution failed' },
        },
      },
    }),
    registerApiRoute('/agentflow/api/execute/status', {
      method: 'GET',
      handler: (c) => fastExecutionAPI.getExecutionStatus(c),
      openapi: {
        summary: 'Get execution status',
        tags: ['AgentFlow - Execution'],
        responses: { '200': { description: 'OK' } },
      },
    }),
  ];
}
