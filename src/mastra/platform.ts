// AgentFlow platform functionality
import { createDynamicAgentBuilder } from './agents/dynamic-agent-builder';
import { createDynamicToolBuilder } from './tools/dynamic-tool-builder';
import { postgresManager } from './database/postgres-manager';
import { logger } from './utils/logger';
import { AgentFlowError, safeAsync, validateOrganizationId } from './utils/helpers';
import { initializeDatabase } from './database/connection-manager';

// Global builders - will be initialized per organization
let globalAgentBuilder: any = null;
let globalToolBuilder: any = null;
let currentOrganizationId: string = 'default';

// Get or create builders for a specific organization
export function getAgentBuilder(organizationId: string = 'default') {
  if (!globalAgentBuilder || currentOrganizationId !== organizationId) {
    globalAgentBuilder = createDynamicAgentBuilder(organizationId);
    currentOrganizationId = organizationId;
  }
  return globalAgentBuilder;
}

export function getToolBuilder(organizationId: string = 'default') {
  if (!globalToolBuilder || currentOrganizationId !== organizationId) {
    globalToolBuilder = createDynamicToolBuilder(organizationId);
    currentOrganizationId = organizationId;
  }
  return globalToolBuilder;
}

// Consolidated initialization function
async function initializePlatform(organizationId: string = 'default'): Promise<void> {
  const normalizedOrgId = validateOrganizationId(organizationId);
  
  try {
    logger.info('Starting AgentFlow platform initialization', { organizationId: normalizedOrgId });
    
    // Step 1: Initialize database connection
    logger.info('Step 1: Initializing database connection');
    await initializeDatabase();
    logger.info('Database connection initialized');
    
    // Step 2: Initialize builders for the organization
    logger.info('Step 2: Initializing builders');
    const agentBuilder = getAgentBuilder(normalizedOrgId);
    const toolBuilder = getToolBuilder(normalizedOrgId);
    
    await agentBuilder.initialize();
    await toolBuilder.initialize();
    logger.info('Builders initialized');
    
    // Step 3: Create sample tools if they don't exist
    logger.info('Step 3: Setting up sample tools');
    await createSampleTools(normalizedOrgId);
    logger.info('Sample tools setup complete');
    
    // Step 4: Register tools with agent builder
    logger.info('Step 4: Registering tools with agent builder');
    await registerToolsWithAgents(normalizedOrgId);
    logger.info('Tools registered with agent builder');
    
    // Step 5: Create and load agents
    logger.info('Step 5: Setting up agents');
    await createSampleAgents(normalizedOrgId);
    await loadAgentsFromDatabase(normalizedOrgId);
    logger.info('Agents initialized and loaded');
    
    // Step 6: Verify initialization
    logger.info('Step 6: Verifying initialization');
    await verifyInitialization(normalizedOrgId);
    
    logger.info('AgentFlow platform initialized successfully', { organizationId: normalizedOrgId });
  } catch (error) {
    logger.error('Error initializing platform', { organizationId: normalizedOrgId }, error instanceof Error ? error : undefined);
    throw error;
  }
}

// Create sample tools
async function createSampleTools(organizationId: string): Promise<void> {
  try {
    // Check if tools already exist in database
    const existingTools = await postgresManager.listTools(organizationId);
    if (existingTools.length > 0) {
      logger.info('Tools already exist, skipping creation', { organizationId });
      return;
    }

    // Create weather tool configuration
    const weatherToolConfig = {
      id: 'weather-tool',
      name: 'Weather Tool',
      description: 'Get current weather information for any location',
      input_schema: JSON.stringify({
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name or coordinates',
          },
          units: {
            type: 'string',
            enum: ['metric', 'imperial'],
            default: 'metric',
          },
        },
        required: ['location'],
      }),
      output_schema: JSON.stringify({
        type: 'object',
        properties: {
          temperature: { type: 'number' },
          humidity: { type: 'number' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
      }),
      api_endpoint: 'https://api.openweathermap.org/data/2.5/weather',
      method: 'GET',
      headers: JSON.stringify({
        'Content-Type': 'application/json',
      }),
      authentication: JSON.stringify({
        type: 'api_key',
        config: {
          apiKey: process.env.OPENWEATHER_API_KEY || 'your-api-key-here',
        },
      }),
      timeout: 10000,
      retries: 3,
      cache_config: JSON.stringify({
        enabled: true,
        ttl: 300, // 5 minutes
      }),
      validation_config: JSON.stringify({
        enabled: true,
      }),
      status: 'active',
      metadata: JSON.stringify({
        category: 'weather',
        tags: ['weather', 'api', 'location'],
      }),
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Save tool to database
    const savedTool = await postgresManager.createTool(organizationId, weatherToolConfig);
    logger.info('Weather tool saved to database', { toolId: savedTool.id, organizationId });

    // Also create the tool in the tool builder for runtime use
    const toolBuilder = getToolBuilder(organizationId);
    const weatherTool = await toolBuilder.createToolFromTemplate('weather-api', {
      id: 'weather-tool',
      name: 'Weather Tool',
      description: 'Get current weather information for any location',
      apiEndpoint: 'https://api.openweathermap.org/data/2.5/weather',
      method: 'GET',
      authentication: {
        type: 'api_key',
        config: {
          apiKey: process.env.OPENWEATHER_API_KEY || 'your-api-key-here',
        },
      },
      inputSchema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name or coordinates',
          },
          units: {
            type: 'string',
            enum: ['metric', 'imperial'],
            default: 'metric',
          },
        },
        required: ['location'],
      },
    });

    // Register the tool with the agent builder
    const agentBuilder = getAgentBuilder(organizationId);
    agentBuilder.registerTool('weather-tool', weatherTool);
    
    logger.info('Sample tools created successfully', { organizationId });
  } catch (error) {
    logger.error('Error creating sample tools', { organizationId }, error instanceof Error ? error : undefined);
    throw error;
  }
}

// Register tools with agent builder after they're loaded
async function registerToolsWithAgents(organizationId: string): Promise<void> {
  try {
    const toolBuilder = getToolBuilder(organizationId);
    const agentBuilder = getAgentBuilder(organizationId);
    const tools = toolBuilder.listTools();
    
    logger.info('Registering tools with agent builder', { toolCount: tools.length, organizationId });
    
    for (const toolConfig of tools) {
      const tool = toolBuilder.getTool(toolConfig.id);
      if (tool) {
        agentBuilder.registerTool(toolConfig.id, tool);
        logger.debug('Registered tool', { toolId: toolConfig.id, toolName: toolConfig.name, organizationId });
      }
    }
    
    logger.info('Successfully registered tools with agent builder', { toolCount: tools.length, organizationId });
  } catch (error) {
    logger.error('Error registering tools with agent builder', { organizationId }, error instanceof Error ? error : undefined);
    throw error;
  }
}

// Create sample agents
async function createSampleAgents(organizationId: string): Promise<void> {
  try {
    // Check if agents already exist in database
    const existingAgents = await postgresManager.listAgents(organizationId);
    if (existingAgents.length > 0) {
      logger.info('Agents already exist, skipping creation', { organizationId });
      return;
    }

    // Create weather agent
    const agentBuilder = getAgentBuilder(organizationId);
    const weatherAgent = await agentBuilder.createAgent({
      id: 'weather-agent',
      name: 'Weather Assistant',
      description: 'A helpful assistant that provides weather information',
      instructions: 'You are a helpful weather assistant. When users ask about weather, use the weather tool to get current conditions.',
      model: 'gpt-4o-mini',
      tools: ['weather-tool'],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    logger.info('Sample agents created successfully', { organizationId });
  } catch (error) {
    logger.error('Error creating sample agents', { organizationId }, error instanceof Error ? error : undefined);
    throw error;
  }
}

// Load agents from database into agent builder
async function loadAgentsFromDatabase(organizationId: string): Promise<void> {
  try {
    const dbAgents = await postgresManager.listAgents(organizationId);
    logger.info('Loading agents from database', { agentCount: dbAgents.length, organizationId });
    
    const agentBuilder = getAgentBuilder(organizationId);
    
    for (const dbAgent of dbAgents) {
      try {
        // Create agent instance in agent builder (this will load it into memory)
        const agent = await agentBuilder.getAgent(dbAgent.id);
        
        if (agent) {
          logger.debug('Loaded agent', { agentId: dbAgent.id, agentName: dbAgent.name, organizationId });
        } else {
          logger.warn('Agent loaded from database but not created in memory', { agentId: dbAgent.id, organizationId });
        }
      } catch (agentError) {
        logger.error('Error loading agent', { agentId: dbAgent.id, organizationId }, agentError instanceof Error ? agentError : undefined);
      }
    }
    
    logger.info('Successfully loaded agents from database', { agentCount: dbAgents.length, organizationId });
  } catch (error) {
    logger.error('Error loading agents from database', { organizationId }, error instanceof Error ? error : undefined);
    throw error;
  }
}

// Verify that initialization was successful
async function verifyInitialization(organizationId: string): Promise<void> {
  try {
    logger.info('Verifying initialization', { organizationId });
    
    const toolBuilder = getToolBuilder(organizationId);
    const agentBuilder = getAgentBuilder(organizationId);
    
    // Check tools
    const dbTools = await postgresManager.listTools(organizationId);
    const memoryTools = toolBuilder.listTools();
    logger.info('Tool verification', { 
      databaseTools: dbTools.length, 
      memoryTools: memoryTools.length, 
      organizationId 
    });
    
    // Check agents
    const dbAgents = await postgresManager.listAgents(organizationId);
    const memoryAgents = await agentBuilder.listAgents();
    logger.info('Agent verification', { 
      databaseAgents: dbAgents.length, 
      memoryAgents: memoryAgents.length, 
      organizationId 
    });
    
    // Verify tool-agent relationships
    for (const agent of memoryAgents) {
      if (agent.tools && agent.tools.length > 0) {
        logger.debug('Agent tool relationships', { 
          agentName: agent.name, 
          toolCount: agent.tools.length, 
          tools: agent.tools.join(', '), 
          organizationId 
        });
        
        // Check if all tools exist
        for (const toolId of agent.tools) {
          const tool = toolBuilder.getTool(toolId);
          if (!tool) {
            logger.warn('Agent references non-existent tool', { 
              agentName: agent.name, 
              toolId, 
              organizationId 
            });
          }
        }
      }
    }
    
    logger.info('Initialization verification completed', { organizationId });
  } catch (error) {
    logger.error('Error during verification', { organizationId }, error instanceof Error ? error : undefined);
    throw error;
  }
}

// Export types
export * from './types';

// Export database manager
export { postgresManager };

// Export initialization functions
export { registerToolsWithAgents, loadAgentsFromDatabase, verifyInitialization };

// Main initialization function for setting up the platform
export async function initializeAgentFlow(organizationId: string = 'default'): Promise<void> {
  await initializePlatform(organizationId);
}

// Example usage and setup
export async function setupAgentFlow(app: any, organizationId: string = 'default'): Promise<void> {
  // Initialize the platform
  await initializeAgentFlow(organizationId);
  
  // Setup API routes
  // Custom routes are now handled by Mastra's registerApiRoute in index.ts
  
  logger.info('AgentFlow platform setup complete', { organizationId });
}

// Export default setup function
export default setupAgentFlow;
