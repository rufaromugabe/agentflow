import { Context } from 'hono';
import { z } from 'zod';
import { DynamicAgentBuilder, AgentConfig, AgentConfigSchema } from '../agents/dynamic-agent-builder';
import { DynamicToolBuilder, ToolConfig, ToolConfigSchema } from '../tools/dynamic-tool-builder';

// Custom API Controllers for AgentFlow Platform
// Note: This complements Mastra's default routes, doesn't duplicate them
export class AgentFlowAPI {
  constructor(
    private agentBuilder: DynamicAgentBuilder,
    private toolBuilder: DynamicToolBuilder
  ) {}

  // Custom Agent Management (beyond Mastra's defaults)
  async createAgent(c: Context): Promise<Response> {
    try {
      const body = await c.req.json();
      const configData = AgentConfigSchema.parse(body);
      const config: AgentConfig = {
        ...configData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const agent = this.agentBuilder.createAgent(config);
      
      return c.json({
        success: true,
        data: {
          id: config.id,
          name: config.name,
          description: config.description,
          status: config.status,
          createdAt: config.createdAt,
        },
      }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        }, 400);
      } else {
        return c.json({
          success: false,
          error: 'Failed to create agent',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    }
  }

  async updateAgent(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const updates = await c.req.json();

      const agent = await this.agentBuilder.updateAgent(agentId, updates);
      
      return c.json({
        success: true,
        data: {
          id: agentId,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({
          success: false,
          error: 'Agent not found',
        }, 404);
      } else {
        return c.json({
          success: false,
          error: 'Failed to update agent',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    }
  }

  async deleteAgent(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const deleted = this.agentBuilder.deleteAgent(agentId);
      
      if (!deleted) {
        return c.json({
          success: false,
          error: 'Agent not found',
        }, 404);
      }

      return c.json({
        success: true,
        message: 'Agent deleted successfully',
      });
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to delete agent',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  // Custom Tool Management (beyond Mastra's defaults)
  async createTool(c: Context): Promise<Response> {
    try {
      const body = await c.req.json();
      const configData = ToolConfigSchema.parse(body);
      const config: ToolConfig = {
        ...configData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const tool = await this.toolBuilder.createTool(config);
      
      return c.json({
        success: true,
        data: {
          id: config.id,
          name: config.name,
          description: config.description,
          status: config.status,
          createdAt: config.createdAt,
        },
      }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        }, 400);
      } else {
        return c.json({
          success: false,
          error: 'Failed to create tool',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    }
  }

  async updateTool(c: Context): Promise<Response> {
    try {
      const { toolId } = c.req.param();
      const updates = await c.req.json();

      const tool = await this.toolBuilder.updateTool(toolId, updates);
      
      return c.json({
        success: true,
        data: {
          id: toolId,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({
          success: false,
          error: 'Tool not found',
        }, 404);
      } else {
        return c.json({
          success: false,
          error: 'Failed to update tool',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    }
  }

  async deleteTool(c: Context): Promise<Response> {
    try {
      const { toolId } = c.req.param();
      const deleted = await this.toolBuilder.deleteTool(toolId);
      
      if (!deleted) {
        return c.json({
          success: false,
          error: 'Tool not found',
        }, 404);
      }

      return c.json({
        success: true,
        message: 'Tool deleted successfully',
      });
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to delete tool',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  // Tool Templates and Advanced Features
  async getToolTemplates(c: Context): Promise<Response> {
    try {
      const templates = this.toolBuilder.getTemplates();
      
      return c.json({
        success: true,
        data: templates,
      });
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to get tool templates',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  async createToolFromTemplate(c: Context): Promise<Response> {
    try {
      const { templateId, customizations } = await c.req.json();
      
      const tool = await this.toolBuilder.createToolFromTemplate(templateId, customizations);
      
      return c.json({
        success: true,
        data: {
          id: customizations.id,
          name: customizations.name,
          templateId,
        },
      }, 201);
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to create tool from template',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  // Advanced Agent Features
  async getAgentConfiguration(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const agent = await this.agentBuilder.getAgent(agentId);
      
      if (!agent) {
        return c.json({
          success: false,
          error: 'Agent not found',
        }, 404);
      }

      // Get the agent configuration from the builder instead of the agent instance
      const agentConfigs = await this.agentBuilder.listAgents();
      const agentConfig = agentConfigs.find(config => config.id === agentId);
      
      if (!agentConfig) {
        return c.json({
          success: false,
          error: 'Agent configuration not found',
        }, 404);
      }

      return c.json({
        success: true,
        data: {
          id: agentConfig.id,
          name: agentConfig.name,
          description: agentConfig.description,
          instructions: agentConfig.instructions,
          model: agentConfig.model,
          tools: agentConfig.tools,
          memory: agentConfig.memory,
          voice: agentConfig.voice,
          status: agentConfig.status,
          metadata: agentConfig.metadata,
          createdAt: agentConfig.createdAt,
          updatedAt: agentConfig.updatedAt,
        },
      });
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to get agent configuration',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  async getAgentTools(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const agent = await this.agentBuilder.getAgent(agentId);
      
      if (!agent) {
        return c.json({
          success: false,
          error: 'Agent not found',
        }, 404);
      }

      // Get the agent configuration to access tools
      const agentConfigs = await this.agentBuilder.listAgents();
      const agentConfig = agentConfigs.find(config => config.id === agentId);
      
      if (!agentConfig) {
        return c.json({
          success: false,
          error: 'Agent configuration not found',
        }, 404);
      }

      const tools = agentConfig.tools?.map(toolId => {
        const tool = this.toolBuilder.getTool(toolId);
        return tool ? {
          id: tool.id,
          name: tool.name,
          description: tool.description,
          status: tool.status,
        } : null;
      }).filter(Boolean) || [];

      return c.json({
        success: true,
        data: tools,
      });
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to get agent tools',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  // Analytics and Monitoring
  async getAgentAnalytics(c: Context): Promise<Response> {
    try {
      const { agentId } = c.req.param();
      const { startDate, endDate } = c.req.query();

      // Placeholder for analytics data - integrate with your analytics system
      const analytics = {
        agentId,
        period: { startDate, endDate },
        metrics: {
          totalRequests: 0,
          averageResponseTime: 0,
          successRate: 0,
          errorRate: 0,
          tokenUsage: {
            input: 0,
            output: 0,
            total: 0,
          },
        },
      };

      return c.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to get agent analytics',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  // Platform Management
  async getPlatformStatus(c: Context): Promise<Response> {
    try {
      const agents = await this.agentBuilder.listAgents();
      const tools = this.toolBuilder.listTools();
      
      return c.json({
        success: true,
        data: {
          platform: 'AgentFlow',
          version: '1.0.0',
          status: 'healthy',
          agents: {
            total: agents.length,
            active: agents.filter(a => a.status === 'active').length,
            inactive: agents.filter(a => a.status === 'inactive').length,
          },
          tools: {
            total: tools.length,
            active: tools.filter(t => t.status === 'active').length,
            inactive: tools.filter(t => t.status === 'inactive').length,
          },
          uptime: process.uptime(),
        },
      });
    } catch (error) {
      return c.json({
        success: false,
        error: 'Failed to get platform status',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }

  // Helper methods
  private createRuntimeContext(c: Context): any {
    // Extract user context from request headers, JWT token, etc.
    return {
      userId: c.req.header('x-user-id') || 'anonymous',
      organizationId: c.req.header('x-organization-id') || 'default',
      environment: process.env.NODE_ENV || 'development',
      userTier: c.req.header('x-user-tier') || 'free',
    };
  }

  private createTestRuntimeContext(): any {
    return {
      userId: 'test-user',
      organizationId: 'test-org',
      environment: 'testing',
      userTier: 'pro',
    };
  }
}
