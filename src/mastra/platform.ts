// AgentFlow platform functionality
import { createDynamicAgentBuilder } from './agents/dynamic-agent-builder';
import { createDynamicToolBuilder } from './tools/dynamic-tool-builder';
// Removed old Express-based route setup - now using Mastra's registerApiRoute
import { postgresManager } from './database/postgres-manager';

// Initialize the dynamic builders
export const agentBuilder = createDynamicAgentBuilder('default');
export const toolBuilder = createDynamicToolBuilder('default');

// Initialize platform with sample data
async function initializePlatform() {
  try {
    console.log('Starting AgentFlow platform initialization...');
    
    // Step 1: Initialize tool builder (this will initialize database and load tools)
    console.log('Step 1: Initializing tool builder...');
    await toolBuilder.initialize();
    console.log('✅ Tool builder initialized and tools loaded');
    
    // Step 2: Create sample tools if they don't exist
    console.log('Step 2: Setting up sample tools...');
    await createSampleTools();
    console.log('✅ Sample tools setup complete');
    
    // Step 3: Register tools with agent builder
    console.log('Step 3: Registering tools with agent builder...');
    await registerToolsWithAgents();
    console.log('✅ Tools registered with agent builder');
    
    // Step 4: Create and load agents
    console.log('Step 4: Setting up agents...');
    await createSampleAgents();
    await loadAgentsFromDatabase();
    console.log('✅ Agents initialized and loaded');
    
    // Step 5: Verify initialization
    console.log('Step 5: Verifying initialization...');
    await verifyInitialization();
    
    console.log('🎉 AgentFlow platform initialized successfully with dynamic agents and tools');
  } catch (error) {
    console.error('❌ Error initializing platform:', error);
    throw error;
  }
}

// Create sample tools
async function createSampleTools() {
  try {
    // Check if tools already exist in database
    const existingTools = await postgresManager.listTools('default');
    if (existingTools.length > 0) {
      console.log('Tools already exist, skipping creation');
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
    const savedTool = await postgresManager.createTool('default', weatherToolConfig);
    console.log('Weather tool saved to database:', savedTool.id);

    // Also create the tool in the tool builder for runtime use
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
    agentBuilder.registerTool('weather-tool', weatherTool);
    
    console.log('Sample tools created successfully');
  } catch (error) {
    console.error('Error creating sample tools:', error);
    throw error;
  }
}

// Register tools with agent builder after they're loaded
async function registerToolsWithAgents() {
  try {
    const tools = toolBuilder.listTools();
    console.log(`Registering ${tools.length} tools with agent builder...`);
    
    for (const toolConfig of tools) {
      const tool = toolBuilder.getTool(toolConfig.id);
      if (tool) {
        agentBuilder.registerTool(toolConfig.id, tool);
        console.log(`✅ Registered tool: ${toolConfig.name} (${toolConfig.id})`);
      }
    }
    
    console.log(`Successfully registered ${tools.length} tools with agent builder`);
  } catch (error) {
    console.error('Error registering tools with agent builder:', error);
    throw error;
  }
}

// Create sample agents
async function createSampleAgents() {
  try {
    // Check if agents already exist in database
    const existingAgents = await postgresManager.listAgents('default');
    if (existingAgents.length > 0) {
      console.log('Agents already exist, skipping creation');
      return;
    }

    // Create weather agent
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

    console.log('Sample agents created successfully');
  } catch (error) {
    console.error('Error creating sample agents:', error);
    throw error;
  }
}

// Load agents from database into agent builder
async function loadAgentsFromDatabase() {
  try {
    const dbAgents = await postgresManager.listAgents('default');
    console.log(`Loading ${dbAgents.length} agents from database...`);
    
    for (const dbAgent of dbAgents) {
      try {
        // Helper function to safely parse JSON
        const safeJsonParse = (value: any, defaultValue: any = null) => {
          if (!value) return defaultValue;
          if (typeof value === 'string') {
            try {
              return JSON.parse(value);
            } catch {
              return defaultValue;
            }
          }
          return value;
        };

        // Create agent configuration from database row
        const agentConfig = {
          id: dbAgent.id,
          name: dbAgent.name,
          description: dbAgent.description,
          instructions: dbAgent.instructions,
          model: dbAgent.model,
          tools: safeJsonParse(dbAgent.tools, []),
          memory: safeJsonParse(dbAgent.memory_config),
          voice: safeJsonParse(dbAgent.voice_config),
          status: dbAgent.status,
          metadata: safeJsonParse(dbAgent.metadata),
          createdAt: new Date(dbAgent.created_at),
          updatedAt: new Date(dbAgent.updated_at),
        };

        // Create agent instance in agent builder (this will load it into memory)
        const agent = await agentBuilder.getAgent(dbAgent.id);
        
        if (agent) {
          console.log(`✅ Loaded agent: ${dbAgent.name} (${dbAgent.id})`);
        } else {
          console.log(`⚠️  Agent ${dbAgent.id} loaded from database but not created in memory`);
        }
      } catch (agentError) {
        console.error(`❌ Error loading agent ${dbAgent.id}:`, agentError);
      }
    }
    
    console.log(`Successfully loaded ${dbAgents.length} agents from database`);
  } catch (error) {
    console.error('Error loading agents from database:', error);
    throw error;
  }
}

// Verify that initialization was successful
async function verifyInitialization() {
  try {
    console.log('Verifying initialization...');
    
    // Check tools
    const dbTools = await postgresManager.listTools('default');
    const memoryTools = toolBuilder.listTools();
    console.log(`📊 Database tools: ${dbTools.length}, Memory tools: ${memoryTools.length}`);
    
    // Check agents
    const dbAgents = await postgresManager.listAgents('default');
    const memoryAgents = await agentBuilder.listAgents();
    console.log(`📊 Database agents: ${dbAgents.length}, Memory agents: ${memoryAgents.length}`);
    
    // Verify tool-agent relationships
    for (const agent of memoryAgents) {
      if (agent.tools && agent.tools.length > 0) {
        console.log(`🔗 Agent ${agent.name} has ${agent.tools.length} tools: ${agent.tools.join(', ')}`);
        
        // Check if all tools exist
        for (const toolId of agent.tools) {
          const tool = toolBuilder.getTool(toolId);
          if (!tool) {
            console.warn(`⚠️  Agent ${agent.name} references tool ${toolId} that doesn't exist in memory`);
          }
        }
      }
    }
    
    console.log('✅ Initialization verification completed');
  } catch (error) {
    console.error('❌ Error during verification:', error);
    throw error;
  }
}

// Initialize the platform
initializePlatform();

// Export types
export * from './types';

// Export API setup function
// Export removed - using Mastra's registerApiRoute instead

// Export database manager
export { postgresManager };

// Export initialization functions
export { registerToolsWithAgents, loadAgentsFromDatabase, verifyInitialization };

// Initialize function for setting up the platform
export async function initializeAgentFlow(organizationId: string = 'default'): Promise<void> {
  try {
    console.log(`Starting AgentFlow platform initialization for organization: ${organizationId}`);
    
    // Initialize tool builder (this will initialize database and load tools)
    await toolBuilder.initialize();
    console.log(`✅ Tool builder initialized for organization: ${organizationId}`);
    
    // Register tools with agent builder
    await registerToolsWithAgents();
    console.log(`✅ Tools registered with agent builder for organization: ${organizationId}`);
    
    // Load existing agents from database
    await loadAgentsFromDatabase();
    console.log(`✅ Agents loaded for organization: ${organizationId}`);
    
    // Verify initialization
    await verifyInitialization();
    
    console.log(`🎉 AgentFlow platform initialized successfully for organization: ${organizationId}`);
  } catch (error) {
    console.error('Failed to initialize AgentFlow platform:', error);
    throw error;
  }
}

// Example usage and setup
export async function setupAgentFlow(app: any, organizationId: string = 'default'): Promise<void> {
  // Initialize the platform
  await initializeAgentFlow(organizationId);
  
  // Setup API routes
  // Custom routes are now handled by Mastra's registerApiRoute in index.ts
  
  console.log('AgentFlow platform setup complete');
}

// Example of creating a sample agent and tool
export async function createSampleAgentAndTool(): Promise<void> {
  // Create a sample tool configuration for database
  const sampleToolConfig = {
    id: 'sample-weather-tool',
    name: 'Sample Weather Tool',
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
      tags: ['weather', 'api', 'location', 'sample'],
    }),
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Save tool to database
  const savedTool = await postgresManager.createTool('default', sampleToolConfig);
  console.log('Sample weather tool saved to database:', savedTool.id);

  // Create a sample tool for runtime use
  const weatherTool = await toolBuilder.createToolFromTemplate('weather-api', {
    id: 'sample-weather-tool',
    name: 'Sample Weather Tool',
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
  agentBuilder.registerTool('sample-weather-tool', weatherTool);

  // Create a sample agent
  const sampleAgent = await agentBuilder.createAgent({
    id: 'sample-weather-agent',
    name: 'Weather Assistant',
    description: 'A helpful assistant that provides weather information',
    instructions: 'You are a helpful weather assistant. When users ask about weather, use the weather tool to get current conditions.',
    model: 'gpt-4o-mini',
    tools: ['sample-weather-tool'],
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log('Sample agent and tool created successfully');
}

// Export default setup function
export default setupAgentFlow;
