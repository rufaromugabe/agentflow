import { registerApiRoute } from '@mastra/core/server';
import { AgentFlowAPI } from './agent-management';
import { DynamicAgentBuilder } from '../agents/dynamic-agent-builder';
import { DynamicToolBuilder } from '../tools/dynamic-tool-builder';
import { z } from 'zod';

/**
 * Custom API Routes for AgentFlow Platform
 * 
 * These routes complement Mastra's default routes and provide additional
 * functionality for agent and tool management beyond what Mastra provides by default.
 * 
 * Mastra Default Routes (we don't duplicate these):
 * - GET /api/agents - List agents
 * - GET /api/agents/:agentId - Get agent by ID
 * - POST /api/agents/:agentId/generate - Generate response
 * - POST /api/agents/:agentId/stream - Stream response
 * - POST /api/agents/:agentId/instructions - Update instructions
 * - POST /api/agents/:agentId/tools/:toolId/execute - Execute tool through agent
 * - GET /api/tools - List tools
 * - GET /api/tools/:toolId - Get tool by ID
 * - POST /api/tools/:toolId/execute - Execute tool directly
 * 
 * OpenAPI Documentation:
 * To make routes appear in Swagger UI with proper parameter documentation,
 * add an 'openapi' property to each registerApiRoute call with:
 * - summary: Brief description
 * - description: Detailed description
 * - tags: Array of tags for grouping
 * - parameters: Array of parameter definitions
 * - requestBody: Request body schema
 * - responses: Response schemas
 * 
 * Example:
 * registerApiRoute('/path', {
 *   method: 'GET',
 *   handler: (c) => handler(c),
 *   openapi: {
 *     summary: 'Route summary',
 *     description: 'Route description',
 *     tags: ['Tag Group'],
 *     parameters: [...],
 *     responses: {...}
 *   }
 * })
 */

export function createCustomRoutes(
  agentBuilder: DynamicAgentBuilder,
  toolBuilder: DynamicToolBuilder
) {
  const api = new AgentFlowAPI(agentBuilder, toolBuilder);

  return [
    // Agent Management Routes (beyond Mastra defaults)
    registerApiRoute('/agentflow/agents', {
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

    registerApiRoute('/agentflow/agents/:agentId', {
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

    registerApiRoute('/agentflow/agents/:agentId', {
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

    registerApiRoute('/agentflow/agents/:agentId/configuration', {
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

    registerApiRoute('/agentflow/agents/:agentId/tools', {
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

    registerApiRoute('/agentflow/agents/:agentId/analytics', {
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

    // Tool Management Routes (beyond Mastra defaults)
    registerApiRoute('/agentflow/tools', {
      method: 'POST',
      handler: (c) => api.createTool(c),
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
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method' },
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

    registerApiRoute('/agentflow/tools/:toolId', {
      method: 'PUT',
      handler: (c) => api.updateTool(c),
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
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method' },
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

    registerApiRoute('/agentflow/tools/:toolId', {
      method: 'DELETE',
      handler: (c) => api.deleteTool(c),
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

    registerApiRoute('/agentflow/tools/templates', {
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

    registerApiRoute('/agentflow/tools/from-template', {
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

    // Platform Management Routes
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

    // Database Status Route
    registerApiRoute('/agentflow/database/status', {
      method: 'GET',
      handler: async (c) => {
        const mastra = c.get('mastra');
        try {
          // Check if we can access the database through Mastra
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

    // Agent Statistics Route
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

    // Bulk Operations Route
    registerApiRoute('/agentflow/bulk/agents', {
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
    registerApiRoute('/agentflow/export/agents', {
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

    registerApiRoute('/agentflow/export/tools', {
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
  ];
}
