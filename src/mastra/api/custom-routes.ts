import { registerApiRoute } from '@mastra/core/server';
import { AgentFlowAPI } from './agent-management';
import { DynamicAgentBuilder } from '../agents/dynamic-agent-builder';
import { DynamicToolBuilder } from '../tools/dynamic-tool-builder';

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
    }),

    registerApiRoute('/agentflow/agents/:agentId', {
      method: 'PUT',
      handler: (c) => api.updateAgent(c),
    }),

    registerApiRoute('/agentflow/agents/:agentId', {
      method: 'DELETE',
      handler: (c) => api.deleteAgent(c),
    }),

    registerApiRoute('/agentflow/agents/:agentId/configuration', {
      method: 'GET',
      handler: (c) => api.getAgentConfiguration(c),
    }),

    registerApiRoute('/agentflow/agents/:agentId/tools', {
      method: 'GET',
      handler: (c) => api.getAgentTools(c),
    }),

    registerApiRoute('/agentflow/agents/:agentId/analytics', {
      method: 'GET',
      handler: (c) => api.getAgentAnalytics(c),
    }),

    // Tool Management Routes (beyond Mastra defaults)
    registerApiRoute('/agentflow/tools', {
      method: 'POST',
      handler: (c) => api.createTool(c),
    }),

    registerApiRoute('/agentflow/tools/:toolId', {
      method: 'PUT',
      handler: (c) => api.updateTool(c),
    }),

    registerApiRoute('/agentflow/tools/:toolId', {
      method: 'DELETE',
      handler: (c) => api.deleteTool(c),
    }),

    registerApiRoute('/agentflow/tools/templates', {
      method: 'GET',
      handler: (c) => api.getToolTemplates(c),
    }),

    registerApiRoute('/agentflow/tools/from-template', {
      method: 'POST',
      handler: (c) => api.createToolFromTemplate(c),
    }),

    // Platform Management Routes
    registerApiRoute('/agentflow/status', {
      method: 'GET',
      handler: (c) => api.getPlatformStatus(c),
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
    }),

    // Bulk Operations Route
    registerApiRoute('/agentflow/bulk/agents', {
      method: 'POST',
      handler: async (c) => {
        try {
          const { operation, agentIds, data } = await c.req.json();
          
          const results = [];
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
    }),
  ];
}
