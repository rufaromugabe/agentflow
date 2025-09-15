// Main entry point for the AgentFlow platform
import { Mastra } from '@mastra/core/mastra';
import { agentBuilder, toolBuilder, setupAgentFlow } from './platform';
import { createCustomRoutes } from './api/custom-routes';

// Function to load dynamic agents from database
async function loadDynamicAgents() {
  try {
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

    return agents;
  } catch (error) {
    console.error('Error loading dynamic agents:', error);
    return {};
  }
}

// Initialize the platform first
await setupAgentFlow(undefined, 'default');

// Initialize dynamic agents
const dynamicAgents = await loadDynamicAgents();

// Create custom routes
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