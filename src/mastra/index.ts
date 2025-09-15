// Main entry point for the AgentFlow platform
import { Mastra } from '@mastra/core/mastra';
import { getAgentBuilder, getToolBuilder, setupAgentFlow } from './platform';
import { createCustomRoutes } from './api/custom-routes';
import { logger } from './utils/logger';

// Function to load dynamic agents from database
async function loadDynamicAgents(organizationId: string = 'default') {
  try {
    const agentBuilder = getAgentBuilder(organizationId);
    // Get all agents from the database
    const agentConfigs = await agentBuilder.listAgents();
    const agents: Record<string, any> = {};

    // Create agent instances for each configuration
    for (const config of agentConfigs) {
      if (config.status === 'active') {
        const agent = await agentBuilder.getAgent(config.id);
        if (agent) {
          agents[config.id] = agent;
        }
      }
    }

    logger.info('Dynamic agents loaded', { agentCount: Object.keys(agents).length, organizationId });
    return agents;
  } catch (error) {
    logger.error('Error loading dynamic agents', { organizationId }, error instanceof Error ? error : undefined);
    return {};
  }
}

// Initialize the platform first
const organizationId = 'default';
await setupAgentFlow(undefined, organizationId);

// Initialize dynamic agents
const dynamicAgents = await loadDynamicAgents(organizationId);

// Create custom routes
const agentBuilder = getAgentBuilder(organizationId);
const toolBuilder = getToolBuilder(organizationId);
const customRoutes = createCustomRoutes(agentBuilder, toolBuilder);

// Create the main Mastra instance with dynamic agents and custom routes
export const mastra = new Mastra({
  agents: dynamicAgents,
  server: {
    apiRoutes: customRoutes,
    build: {
      openAPIDocs: true,
      swaggerUI: true,
    },
  },
});

logger.info('AgentFlow platform initialized successfully', { organizationId });