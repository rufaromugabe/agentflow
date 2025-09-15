import { Pool, PoolClient } from 'pg';
import { PostgresStore } from '@mastra/pg';
import { DatabaseSchema, AgentTable, ToolTable, ToolTemplateTable, AgentExecutionTable, ToolExecutionTable, AnalyticsTable } from '../types';

// PostgreSQL Database Manager
export class PostgreSQLManager {
  private pool: Pool;
  private schemas: Map<string, DatabaseSchema> = new Map();

  constructor() {
    // Initialize PostgreSQL connection pool using DATABASE_URL
    const connectionString = process.env.DATABASE_URL || 'postgresql://user:none@localhost:5432/agentflow';
    
    this.pool = new Pool({
      connectionString,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.initializeDefaultSchema();
  }

  private initializeDefaultSchema() {
    // Default schema for the main organization
    const defaultSchema: DatabaseSchema = {
      name: 'default',
      tables: {
        agents: this.createAgentTable(),
        tools: this.createToolTable(),
        tool_templates: this.createToolTemplateTable(),
        agent_executions: this.createAgentExecutionTable(),
        tool_executions: this.createToolExecutionTable(),
        analytics: this.createAnalyticsTable(),
      },
    };

    this.schemas.set('default', defaultSchema);
  }

  // Create schema for a specific organization
  createOrganizationSchema(organizationId: string): DatabaseSchema {
    const schema: DatabaseSchema = {
      name: organizationId,
      tables: {
        agents: this.createAgentTable(),
        tools: this.createToolTable(),
        tool_templates: this.createToolTemplateTable(),
        agent_executions: this.createAgentExecutionTable(),
        tool_executions: this.createToolExecutionTable(),
        analytics: this.createAnalyticsTable(),
      },
    };

    this.schemas.set(organizationId, schema);
    return schema;
  }

  getSchema(organizationId: string): DatabaseSchema | null {
    return this.schemas.get(organizationId) || null;
  }

  // Initialize organization database schema
  async initializeOrganization(organizationId: string): Promise<void> {
    const schema = this.getSchema(organizationId) || this.createOrganizationSchema(organizationId);
    
    const client = await this.pool.connect();
    try {
      // Create schema if it doesn't exist
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${organizationId}"`);
      
      // Create tables
      await this.createTables(client, organizationId, schema);
      
      console.log(`PostgreSQL schema initialized for organization: ${organizationId}`);
    } catch (error) {
      console.error(`Error initializing PostgreSQL schema for ${organizationId}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async createTables(client: PoolClient, organizationId: string, schema: DatabaseSchema): Promise<void> {
    // Create agents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".agents (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        instructions TEXT NOT NULL,
        model VARCHAR(100) NOT NULL,
        tools JSONB,
        memory_config JSONB,
        voice_config JSONB,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        workspace_id VARCHAR(255)
      )
    `);

    // Create tools table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".tools (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        input_schema JSONB NOT NULL,
        output_schema JSONB,
        api_endpoint VARCHAR(500),
        method VARCHAR(10),
        headers JSONB,
        authentication JSONB,
        rate_limit JSONB,
        timeout INTEGER,
        retries INTEGER,
        cache_config JSONB,
        validation_config JSONB,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        workspace_id VARCHAR(255)
      )
    `);

    // Create tool_templates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".tool_templates (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        template JSONB NOT NULL,
        examples JSONB,
        tags JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create agent_executions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".agent_executions (
        id VARCHAR(255) PRIMARY KEY,
        agent_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        organization_id VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        response TEXT,
        usage JSONB,
        finish_reason VARCHAR(50),
        tool_calls JSONB,
        execution_time INTEGER,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create tool_executions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".tool_executions (
        id VARCHAR(255) PRIMARY KEY,
        tool_id VARCHAR(255) NOT NULL,
        agent_id VARCHAR(255),
        user_id VARCHAR(255) NOT NULL,
        organization_id VARCHAR(255) NOT NULL,
        input JSONB NOT NULL,
        output JSONB,
        execution_time INTEGER,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        cache_hit BOOLEAN DEFAULT FALSE,
        retries INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create analytics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".analytics (
        id VARCHAR(255) PRIMARY KEY,
        agent_id VARCHAR(255),
        tool_id VARCHAR(255),
        user_id VARCHAR(255) NOT NULL,
        organization_id VARCHAR(255) NOT NULL,
        metric_type VARCHAR(50) NOT NULL,
        metric_value DECIMAL(10,2) NOT NULL,
        metadata JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create memory-related tables for Mastra memory system
    await this.createMemoryTables(client, organizationId);

    // Create indexes
    await this.createIndexes(client, organizationId);
  }

  private async createMemoryTables(client: PoolClient, organizationId: string): Promise<void> {
    // Create threads table for conversation threads
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".threads (
        id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(500),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create messages table for storing conversation messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".messages (
        id VARCHAR(255) PRIMARY KEY,
        thread_id VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES "${organizationId}".threads(id) ON DELETE CASCADE
      )
    `);

    // Create message_embeddings table for vector storage (only if pgvector is available)
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${organizationId}".message_embeddings (
          id VARCHAR(255) PRIMARY KEY,
          message_id VARCHAR(255) NOT NULL,
          embedding VECTOR(1536),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (message_id) REFERENCES "${organizationId}".messages(id) ON DELETE CASCADE
        )
      `);
    } catch (error) {
      console.warn(`Vector extension not available, creating message_embeddings without vector column: ${error.message}`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${organizationId}".message_embeddings (
          id VARCHAR(255) PRIMARY KEY,
          message_id VARCHAR(255) NOT NULL,
          embedding_text TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (message_id) REFERENCES "${organizationId}".messages(id) ON DELETE CASCADE
        )
      `);
    }

    // Create resources table for resource-scoped memory
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".resources (
        id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create resource_messages table for linking messages to resources
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".resource_messages (
        id VARCHAR(255) PRIMARY KEY,
        resource_id VARCHAR(255) NOT NULL,
        message_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (resource_id) REFERENCES "${organizationId}".resources(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES "${organizationId}".messages(id) ON DELETE CASCADE
      )
    `);

    // Create working_memory table for temporary memory storage
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".working_memory (
        id VARCHAR(255) PRIMARY KEY,
        thread_id VARCHAR(255),
        resource_id VARCHAR(255),
        key VARCHAR(255) NOT NULL,
        value JSONB NOT NULL,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES "${organizationId}".threads(id) ON DELETE CASCADE,
        FOREIGN KEY (resource_id) REFERENCES "${organizationId}".resources(id) ON DELETE CASCADE
      )
    `);
  }

  private async createIndexes(client: PoolClient, organizationId: string): Promise<void> {
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_agents_status ON "${organizationId}".agents (status)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_created_at ON "${organizationId}".agents (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON "${organizationId}".agents (workspace_id)`,
      
      `CREATE INDEX IF NOT EXISTS idx_tools_status ON "${organizationId}".tools (status)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_created_at ON "${organizationId}".tools (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_workspace_id ON "${organizationId}".tools (workspace_id)`,
      
      `CREATE INDEX IF NOT EXISTS idx_tool_templates_category ON "${organizationId}".tool_templates (category)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_templates_created_at ON "${organizationId}".tool_templates (created_at)`,
      
      `CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_id ON "${organizationId}".agent_executions (agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_executions_user_id ON "${organizationId}".agent_executions (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_executions_organization_id ON "${organizationId}".agent_executions (organization_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_executions_status ON "${organizationId}".agent_executions (status)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_executions_created_at ON "${organizationId}".agent_executions (created_at)`,
      
      `CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_id ON "${organizationId}".tool_executions (tool_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_executions_agent_id ON "${organizationId}".tool_executions (agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_executions_user_id ON "${organizationId}".tool_executions (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_executions_organization_id ON "${organizationId}".tool_executions (organization_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_executions_status ON "${organizationId}".tool_executions (status)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at ON "${organizationId}".tool_executions (created_at)`,
      
      `CREATE INDEX IF NOT EXISTS idx_analytics_agent_id ON "${organizationId}".analytics (agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_tool_id ON "${organizationId}".analytics (tool_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_user_id ON "${organizationId}".analytics (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_organization_id ON "${organizationId}".analytics (organization_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_metric_type ON "${organizationId}".analytics (metric_type)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON "${organizationId}".analytics (timestamp)`,
      
      // Memory table indexes
      `CREATE INDEX IF NOT EXISTS idx_threads_created_at ON "${organizationId}".threads (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON "${organizationId}".threads (updated_at)`,
      
      `CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON "${organizationId}".messages (thread_id)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_role ON "${organizationId}".messages (role)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON "${organizationId}".messages (created_at)`,
      
      `CREATE INDEX IF NOT EXISTS idx_message_embeddings_message_id ON "${organizationId}".message_embeddings (message_id)`,
      `CREATE INDEX IF NOT EXISTS idx_message_embeddings_created_at ON "${organizationId}".message_embeddings (created_at)`,
      
      `CREATE INDEX IF NOT EXISTS idx_resources_type ON "${organizationId}".resources (type)`,
      `CREATE INDEX IF NOT EXISTS idx_resources_created_at ON "${organizationId}".resources (created_at)`,
      
      `CREATE INDEX IF NOT EXISTS idx_resource_messages_resource_id ON "${organizationId}".resource_messages (resource_id)`,
      `CREATE INDEX IF NOT EXISTS idx_resource_messages_message_id ON "${organizationId}".resource_messages (message_id)`,
      
      `CREATE INDEX IF NOT EXISTS idx_working_memory_thread_id ON "${organizationId}".working_memory (thread_id)`,
      `CREATE INDEX IF NOT EXISTS idx_working_memory_resource_id ON "${organizationId}".working_memory (resource_id)`,
      `CREATE INDEX IF NOT EXISTS idx_working_memory_key ON "${organizationId}".working_memory (key)`,
      `CREATE INDEX IF NOT EXISTS idx_working_memory_expires_at ON "${organizationId}".working_memory (expires_at)`,
    ];

    for (const indexQuery of indexes) {
      await client.query(indexQuery);
    }
  }

  // CRUD operations for agents
  async createAgent(organizationId: string, agent: any): Promise<any> {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO "${organizationId}".agents 
        (id, name, description, instructions, model, tools, memory_config, voice_config, status, metadata, created_at, updated_at, workspace_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `;
      
      const values = [
        agent.id,
        agent.name,
        agent.description,
        agent.instructions,
        agent.model,
        JSON.stringify(agent.tools || []),
        JSON.stringify(agent.memory_config || {}),
        JSON.stringify(agent.voice_config || {}),
        agent.status || 'active',
        JSON.stringify(agent.metadata || {}),
        agent.created_at || new Date(),
        agent.updated_at || new Date(),
        agent.workspace_id || null
      ];

      const result = await client.query(query, values);
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async getAgent(organizationId: string, agentId: string): Promise<any> {
    const client = await this.pool.connect();
    try {
      const query = `SELECT * FROM "${organizationId}".agents WHERE id = $1`;
      const result = await client.query(query, [agentId]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async listAgents(organizationId: string): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const query = `SELECT * FROM "${organizationId}".agents ORDER BY created_at DESC`;
      const result = await client.query(query);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async updateAgent(organizationId: string, agentId: string, updates: any): Promise<any> {
    const client = await this.pool.connect();
    try {
      const setClause = Object.keys(updates)
        .map((key, index) => `${key} = $${index + 2}`)
        .join(', ');
      
      const query = `
        UPDATE "${organizationId}".agents 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `;
      
      const values = [agentId, ...Object.values(updates)];
      const result = await client.query(query, values);
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async deleteAgent(organizationId: string, agentId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const query = `DELETE FROM "${organizationId}".agents WHERE id = $1`;
      const result = await client.query(query, [agentId]);
      return (result.rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  // CRUD operations for tools
  async createTool(organizationId: string, tool: any): Promise<any> {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO "${organizationId}".tools 
        (id, name, description, input_schema, output_schema, api_endpoint, method, headers, authentication, rate_limit, timeout, retries, cache_config, validation_config, status, metadata, created_at, updated_at, workspace_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *
      `;
      
      const values = [
        tool.id,
        tool.name,
        tool.description,
        JSON.stringify(tool.input_schema),
        JSON.stringify(tool.output_schema || {}),
        tool.api_endpoint,
        tool.method,
        JSON.stringify(tool.headers || {}),
        JSON.stringify(tool.authentication || {}),
        JSON.stringify(tool.rate_limit || {}),
        tool.timeout,
        tool.retries,
        JSON.stringify(tool.cache_config || {}),
        JSON.stringify(tool.validation_config || {}),
        tool.status || 'active',
        JSON.stringify(tool.metadata || {}),
        tool.created_at || new Date(),
        tool.updated_at || new Date(),
        tool.workspace_id || null
      ];

      const result = await client.query(query, values);
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async getTool(organizationId: string, toolId: string): Promise<any> {
    const client = await this.pool.connect();
    try {
      const query = `SELECT * FROM "${organizationId}".tools WHERE id = $1`;
      const result = await client.query(query, [toolId]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async listTools(organizationId: string): Promise<any[]> {
    const client = await this.pool.connect();
    try {
      const query = `SELECT * FROM "${organizationId}".tools ORDER BY created_at DESC`;
      const result = await client.query(query);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async updateTool(organizationId: string, toolId: string, updates: any): Promise<any> {
    const client = await this.pool.connect();
    try {
      const setClause = Object.keys(updates)
        .map((key, index) => `${key} = $${index + 2}`)
        .join(', ');
      
      const query = `
        UPDATE "${organizationId}".tools 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `;
      
      const values = [toolId, ...Object.values(updates)];
      const result = await client.query(query, values);
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async deleteTool(organizationId: string, toolId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const query = `DELETE FROM "${organizationId}".tools WHERE id = $1`;
      const result = await client.query(query, [toolId]);
      return (result.rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  // Create table definitions (same as before but for PostgreSQL)
  private createAgentTable(): AgentTable {
    return {
      id: '',
      name: '',
      description: '',
      instructions: '',
      model: '',
      tools: [],
      memory_config: undefined,
      voice_config: undefined,
      status: 'active',
      metadata: undefined,
      created_at: new Date(),
      updated_at: new Date(),
      workspace_id: undefined,
    };
  }

  private createToolTable(): ToolTable {
    return {
      id: '',
      name: '',
      description: '',
      input_schema: '',
      output_schema: undefined,
      api_endpoint: undefined,
      method: undefined,
      headers: undefined,
      authentication: undefined,
      rate_limit: undefined,
      timeout: undefined,
      retries: undefined,
      cache_config: undefined,
      validation_config: undefined,
      status: 'active',
      metadata: undefined,
      created_at: new Date(),
      updated_at: new Date(),
      workspace_id: undefined,
    };
  }

  private createToolTemplateTable(): ToolTemplateTable {
    return {
      id: '',
      name: '',
      description: '',
      category: '',
      template: '',
      examples: '',
      tags: '',
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  private createAgentExecutionTable(): AgentExecutionTable {
    return {
      id: '',
      agent_id: '',
      user_id: '',
      organization_id: '',
      message: '',
      response: '',
      usage: undefined,
      finish_reason: undefined,
      tool_calls: undefined,
      execution_time: 0,
      status: 'success',
      error_message: undefined,
      created_at: new Date(),
    };
  }

  private createToolExecutionTable(): ToolExecutionTable {
    return {
      id: '',
      tool_id: '',
      agent_id: undefined,
      user_id: '',
      organization_id: '',
      input: '',
      output: '',
      execution_time: 0,
      status: 'success',
      error_message: undefined,
      cache_hit: undefined,
      retries: undefined,
      created_at: new Date(),
    };
  }

  private createAnalyticsTable(): AnalyticsTable {
    return {
      id: '',
      agent_id: undefined,
      tool_id: undefined,
      user_id: '',
      organization_id: '',
      metric_type: 'request',
      metric_value: 0,
      metadata: undefined,
      timestamp: new Date(),
    };
  }

  // Close the connection pool
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Export singleton instance
export const postgresManager = new PostgreSQLManager();
