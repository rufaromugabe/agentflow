import { Memory } from "@mastra/memory";
import { PostgresStore, PgVector } from "@mastra/pg";
import { fastembed } from "@mastra/fastembed";
import { logger } from "../utils/logger";
import { AgentFlowError, validateOrganizationId } from "../utils/helpers";
import { getConnectionManager } from "../database/connection-manager";

// Helper function to check if pgvector extension is available
async function isPgVectorAvailable(organizationId: string): Promise<boolean> {
  try {
    const connectionManager = getConnectionManager();
    
    // Try to create a test table with vector column
    await connectionManager.createSchemaIfNotExists(organizationId);
    await connectionManager.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}"._test_vector (
        id SERIAL PRIMARY KEY,
        test_vector VECTOR(10)
      )
    `);
    await connectionManager.query(`DROP TABLE IF EXISTS "${organizationId}"._test_vector`);
    
    return true;
  } catch (error) {
    logger.warn('pgvector extension not available', { 
      organizationId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return false;
  }
}

// Memory configuration interface
export interface MemoryConfig {
  organizationId: string;
  agentId: string;
  agentName: string;
  options: {
    lastMessages?: number;
    semanticRecall?: boolean | {
      topK?: number;
      messageRange?: number;
    };
    workingMemory?: boolean;
    scope?: 'thread' | 'resource' | 'organization';
    generateTitle?: boolean;
  };
}

// Memory configuration factory
export function createMemoryConfig(
  organizationId: string,
  agentId: string,
  agentName: string,
  options: MemoryConfig['options'] = {}
): MemoryConfig {
  return {
    organizationId: validateOrganizationId(organizationId),
    agentId,
    agentName,
    options: {
      lastMessages: 10,
      semanticRecall: {
        topK: 3,
        messageRange: 2
      }, // Enabled by default when pgvector is available
      workingMemory: true,
      scope: 'resource',
      generateTitle: true,
      ...options
    }
  };
}

// Organization memory factory
export async function createOrganizationMemory(config: MemoryConfig): Promise<Memory> {
  const { organizationId, options } = config;
  
  // Create connection string with schema name as organization ID
  const connectionString = process.env.DATABASE_URL!;
  
  // Check if pgvector is available
  const pgVectorAvailable = await isPgVectorAvailable(organizationId);
  
  // Create memory instance with PostgreSQL storage
  const memory = new Memory({
    storage: new PostgresStore({
      connectionString,
      // Use organization ID as schema name for data isolation
      schemaName: organizationId
    }),
    // Only add vector support if pgvector is available
    ...(pgVectorAvailable ? {
      vector: new PgVector({
        connectionString,
        // Use organization ID as schema name for vector storage
        schemaName: organizationId
      }),
      embedder: fastembed,
    } : {}),
    options: {
      threads: {
        generateTitle: options.generateTitle || true
      },
      lastMessages: options.lastMessages || 10,
      // Only enable semantic recall if pgvector is available and explicitly requested
      semanticRecall: pgVectorAvailable && options.semanticRecall ? {
        topK: typeof options.semanticRecall === 'object' 
          ? options.semanticRecall.topK || 3 
          : 3,
        messageRange: typeof options.semanticRecall === 'object' 
          ? options.semanticRecall.messageRange || 2 
          : 2
      } : undefined,
      workingMemory: options.workingMemory ? { enabled: true } : undefined
    }
  });

  logger.debug('Organization memory created', { 
    organizationId, 
    pgVectorAvailable, 
    semanticRecall: !!options.semanticRecall 
  });

  return memory;
}

// Memory manager for handling multiple agents within an organization
export class OrganizationMemoryManager {
  private memories: Map<string, Memory> = new Map();
  private organizationId: string;

  constructor(organizationId: string) {
    this.organizationId = validateOrganizationId(organizationId);
  }

  // Get or create memory for a specific agent
  async getAgentMemory(agentId: string, agentName: string, options?: MemoryConfig['options']): Promise<Memory> {
    const memoryKey = `${this.organizationId}:${agentId}`;
    
    if (!this.memories.has(memoryKey)) {
      const config = createMemoryConfig(this.organizationId, agentId, agentName, options);
      const memory = await createOrganizationMemory(config);
      this.memories.set(memoryKey, memory);
    }

    return this.memories.get(memoryKey)!;
  }

  // Initialize all memories for the organization
  async initialize(): Promise<void> {
    try {
      const connectionManager = getConnectionManager();
      
      // Ensure the organization schema exists
      await connectionManager.createSchemaIfNotExists(this.organizationId);
      
      // Initialize pgvector extension in the organization schema
      await connectionManager.createExtensionIfNotExists('vector', this.organizationId);
      
      logger.info('Memory system initialized', { organizationId: this.organizationId });
    } catch (error) {
      logger.error('Failed to initialize memory', { organizationId: this.organizationId }, error instanceof Error ? error : undefined);
      throw new AgentFlowError(
        'Failed to initialize memory system',
        'MEMORY_INIT_ERROR',
        { organizationId: this.organizationId }
      );
    }
  }

  // Clean up memories
  async cleanup(): Promise<void> {
    for (const [key, memory] of this.memories) {
      try {
        // Memory cleanup if needed
        logger.debug('Cleaning up memory', { memoryKey: key, organizationId: this.organizationId });
      } catch (error) {
        logger.error('Error cleaning up memory', { memoryKey: key, organizationId: this.organizationId }, error instanceof Error ? error : undefined);
      }
    }
    this.memories.clear();
  }

  // Get memory statistics for the organization
  getMemoryStats(): {
    organizationId: string;
    activeMemories: number;
    totalAgents: number;
  } {
    return {
      organizationId: this.organizationId,
      activeMemories: this.memories.size,
      totalAgents: this.memories.size
    };
  }
}

// Global memory managers registry
const memoryManagers = new Map<string, OrganizationMemoryManager>();

// Get or create memory manager for an organization
export function getMemoryManager(organizationId: string): OrganizationMemoryManager {
  const normalizedOrgId = validateOrganizationId(organizationId);
  if (!memoryManagers.has(normalizedOrgId)) {
    memoryManagers.set(normalizedOrgId, new OrganizationMemoryManager(normalizedOrgId));
  }
  return memoryManagers.get(normalizedOrgId)!;
}

// Initialize memory for an organization
export async function initializeOrganizationMemory(organizationId: string): Promise<void> {
  const manager = getMemoryManager(organizationId);
  await manager.initialize();
}

// Cleanup all memory managers
export async function cleanupAllMemories(): Promise<void> {
  for (const [organizationId, manager] of memoryManagers) {
    await manager.cleanup();
  }
  memoryManagers.clear();
}
