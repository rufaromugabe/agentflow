import { Pool, PoolClient } from 'pg';
import { PostgresStore } from '@mastra/pg';
import { DatabaseSchema, AgentTable, ToolTable, ToolTemplateTable, AgentExecutionTable, ToolExecutionTable, AnalyticsTable } from '../types';
import { logger } from '../utils/logger';
import { AgentFlowError, validateOrganizationId, safeJsonParse, safeJsonStringify } from '../utils/helpers';
import { getConnectionManager } from './connection-manager';

// PostgreSQL Database Manager
export class PostgreSQLManager {
  private schemas: Map<string, DatabaseSchema> = new Map();

  constructor() {
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
    const normalizedOrgId = validateOrganizationId(organizationId);
    const schema = this.getSchema(normalizedOrgId) || this.createOrganizationSchema(normalizedOrgId);
    
    const connectionManager = getConnectionManager();
    
    try {
      // Create schema if it doesn't exist
      await connectionManager.createSchemaIfNotExists(normalizedOrgId);
      
      // Create tables
      await this.createTables(connectionManager, normalizedOrgId, schema);
      
      logger.info('PostgreSQL schema initialized', { organizationId: normalizedOrgId });
    } catch (error) {
      logger.error('Error initializing PostgreSQL schema', { organizationId: normalizedOrgId }, error instanceof Error ? error : undefined);
      throw new AgentFlowError(
        'Failed to initialize PostgreSQL schema',
        'SCHEMA_INIT_ERROR',
        { organizationId: normalizedOrgId }
      );
    }
  }

  private async createTables(connectionManager: any, organizationId: string, schema: DatabaseSchema): Promise<void> {
    // Create agents table with deployment state
    await connectionManager.query(`
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
        workspace_id VARCHAR(255),
        -- Deployment state for fast execution
        is_deployed BOOLEAN DEFAULT FALSE,
        deployed_state JSONB,
        deployed_at TIMESTAMP,
        version INTEGER DEFAULT 1
      )
    `);

    // Create tools table with deployment state
    await connectionManager.query(`
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
        workspace_id VARCHAR(255),
        -- Deployment state for fast execution
        is_deployed BOOLEAN DEFAULT FALSE,
        deployed_state JSONB,
        deployed_at TIMESTAMP,
        version INTEGER DEFAULT 1
      )
    `);

    // Create tool_templates table
    await connectionManager.query(`
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
    await connectionManager.query(`
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
    await connectionManager.query(`
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
    await connectionManager.query(`
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
    await this.createMemoryTables(connectionManager, organizationId);

    // Ensure deployment columns exist on legacy installations
    await connectionManager.query(`
      ALTER TABLE "${organizationId}".agents 
      ADD COLUMN IF NOT EXISTS is_deployed BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deployed_state JSONB,
      ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1
    `);

    await connectionManager.query(`
      ALTER TABLE "${organizationId}".tools 
      ADD COLUMN IF NOT EXISTS is_deployed BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deployed_state JSONB,
      ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1
    `);

    // Create indexes
    await this.createIndexes(connectionManager, organizationId);
  }

  private async createMemoryTables(connectionManager: any, organizationId: string): Promise<void> {
    // Create threads table for conversation threads
    await connectionManager.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".threads (
        id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(500),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create messages table for storing conversation messages
    await connectionManager.query(`
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
      await connectionManager.query(`
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
      await connectionManager.query(`
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
    await connectionManager.query(`
      CREATE TABLE IF NOT EXISTS "${organizationId}".resources (
        id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create resource_messages table for linking messages to resources
    await connectionManager.query(`
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
    await connectionManager.query(`
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

  private async createIndexes(connectionManager: any, organizationId: string): Promise<void> {
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_agents_status ON "${organizationId}".agents (status)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_created_at ON "${organizationId}".agents (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON "${organizationId}".agents (workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_is_deployed ON "${organizationId}".agents (is_deployed)`,
      `CREATE INDEX IF NOT EXISTS idx_agents_deployed_at ON "${organizationId}".agents (deployed_at)`,
      
      `CREATE INDEX IF NOT EXISTS idx_tools_status ON "${organizationId}".tools (status)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_created_at ON "${organizationId}".tools (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_workspace_id ON "${organizationId}".tools (workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_is_deployed ON "${organizationId}".tools (is_deployed)`,
      `CREATE INDEX IF NOT EXISTS idx_tools_deployed_at ON "${organizationId}".tools (deployed_at)`,
      
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
      await connectionManager.query(indexQuery);
    }
  }

  // CRUD operations for agents
  async createAgent(organizationId: string, agent: any): Promise<any> {
    const connectionManager = getConnectionManager();
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

    const result = await connectionManager.query(query, values);
    return result[0];
  }

  async getAgent(organizationId: string, agentId: string): Promise<any> {
    const connectionManager = getConnectionManager();
    try {
      const query = `SELECT * FROM "${organizationId}".agents WHERE id = $1`;
      const result = await connectionManager.query(query, [agentId]);
      return result[0] || null;
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async listAgents(organizationId: string): Promise<any[]> {
    const connectionManager = getConnectionManager();
    try {
      const query = `SELECT * FROM "${organizationId}".agents ORDER BY created_at DESC`;
      const result = await connectionManager.query(query);
      return result;
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async updateAgent(organizationId: string, agentId: string, updates: any): Promise<any> {
    const connectionManager = getConnectionManager();
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
      const result = await connectionManager.query(query, values);
      return result[0];
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async deleteAgent(organizationId: string, agentId: string): Promise<boolean> {
    const connectionManager = getConnectionManager();
    try {
      const query = `DELETE FROM "${organizationId}".agents WHERE id = $1`;
      const result = await connectionManager.query(query, [agentId]);
      return result.length > 0;
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  // CRUD operations for tools
  async createTool(organizationId: string, tool: any): Promise<any> {
    const connectionManager = getConnectionManager();
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

      const result = await connectionManager.query(query, values);
      return result[0];
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async getTool(organizationId: string, toolId: string): Promise<any> {
    const connectionManager = getConnectionManager();
    try {
      const query = `SELECT * FROM "${organizationId}".tools WHERE id = $1`;
      const result = await connectionManager.query(query, [toolId]);
      return result[0] || null;
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async listTools(organizationId: string): Promise<any[]> {
    const connectionManager = getConnectionManager();
    try {
      const query = `SELECT * FROM "${organizationId}".tools ORDER BY created_at DESC`;
      const result = await connectionManager.query(query);
      return result;
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async updateTool(organizationId: string, toolId: string, updates: any): Promise<any> {
    const connectionManager = getConnectionManager();
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
      const result = await connectionManager.query(query, values);
      return result[0];
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async deleteTool(organizationId: string, toolId: string): Promise<boolean> {
    const connectionManager = getConnectionManager();
    try {
      const query = `DELETE FROM "${organizationId}".tools WHERE id = $1`;
      const result = await connectionManager.query(query, [toolId]);
      return result.length > 0;
    } catch (error) {
      logger.error('Database operation failed', { organizationId, operation: 'database_operation' }, error instanceof Error ? error : undefined);
      throw error;
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

  // Deployment methods for fast execution
  async deployAgent(organizationId: string, agentId: string, deployedState: any): Promise<boolean> {
    const connectionManager = getConnectionManager();
    try {
      const query = `
        UPDATE "${organizationId}".agents 
        SET is_deployed = TRUE, deployed_state = $2, deployed_at = CURRENT_TIMESTAMP, version = version + 1
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await connectionManager.query(query, [agentId, safeJsonStringify(deployedState)]);
      return result.length > 0;
    } catch (error) {
      logger.error('Failed to deploy agent', { organizationId, agentId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async deployTool(organizationId: string, toolId: string, deployedState: any): Promise<boolean> {
    const connectionManager = getConnectionManager();
    try {
      const query = `
        UPDATE "${organizationId}".tools 
        SET is_deployed = TRUE, deployed_state = $2, deployed_at = CURRENT_TIMESTAMP, version = version + 1
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await connectionManager.query(query, [toolId, safeJsonStringify(deployedState)]);
      return result.length > 0;
    } catch (error) {
      logger.error('Failed to deploy tool', { organizationId, toolId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async getDeployedAgentState(organizationId: string, agentId: string): Promise<any> {
    const connectionManager = getConnectionManager();
    try {
      const query = `
        SELECT is_deployed, deployed_state, deployed_at, version 
        FROM "${organizationId}".agents 
        WHERE id = $1 AND is_deployed = TRUE
        LIMIT 1
      `;
      
      const result = await connectionManager.query(query, [agentId]);
      if (result.length === 0) {
        return null;
      }
      
      const row = result[0];
      return {
        isDeployed: row.is_deployed,
        deployedState: safeJsonParse(row.deployed_state, null),
        deployedAt: row.deployed_at,
        version: row.version
      };
    } catch (error) {
      logger.error('Failed to get deployed agent state', { organizationId, agentId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async getDeployedToolState(organizationId: string, toolId: string): Promise<any> {
    const connectionManager = getConnectionManager();
    try {
      const query = `
        SELECT is_deployed, deployed_state, deployed_at, version 
        FROM "${organizationId}".tools 
        WHERE id = $1 AND is_deployed = TRUE
        LIMIT 1
      `;
      
      const result = await connectionManager.query(query, [toolId]);
      if (result.length === 0) {
        return null;
      }
      
      const row = result[0];
      return {
        isDeployed: row.is_deployed,
        deployedState: safeJsonParse(row.deployed_state, null),
        deployedAt: row.deployed_at,
        version: row.version
      };
    } catch (error) {
      logger.error('Failed to get deployed tool state', { organizationId, toolId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async listDeployedAgents(organizationId: string): Promise<any[]> {
    const connectionManager = getConnectionManager();
    try {
      const query = `
        SELECT id, name, deployed_state, deployed_at, version 
        FROM "${organizationId}".agents 
        WHERE is_deployed = TRUE AND status = 'active'
        ORDER BY deployed_at DESC
      `;
      
      const result = await connectionManager.query(query);
      return result.map((row: any) => ({
        id: row.id,
        name: row.name,
        deployedState: safeJsonParse(row.deployed_state, null),
        deployedAt: row.deployed_at,
        version: row.version
      }));
    } catch (error) {
      logger.error('Failed to list deployed agents', { organizationId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async listDeployedTools(organizationId: string): Promise<any[]> {
    const connectionManager = getConnectionManager();
    try {
      const query = `
        SELECT id, name, deployed_state, deployed_at, version 
        FROM "${organizationId}".tools 
        WHERE is_deployed = TRUE AND status = 'active'
        ORDER BY deployed_at DESC
      `;
      
      const result = await connectionManager.query(query);
      return result.map((row: any) => ({
        id: row.id,
        name: row.name,
        deployedState: safeJsonParse(row.deployed_state, null),
        deployedAt: row.deployed_at,
        version: row.version
      }));
    } catch (error) {
      logger.error('Failed to list deployed tools', { organizationId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async undeployAgent(organizationId: string, agentId: string): Promise<boolean> {
    const connectionManager = getConnectionManager();
    try {
      const query = `
        UPDATE "${organizationId}".agents 
        SET is_deployed = FALSE, deployed_state = NULL, deployed_at = NULL
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await connectionManager.query(query, [agentId]);
      return result.length > 0;
    } catch (error) {
      logger.error('Failed to undeploy agent', { organizationId, agentId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async undeployTool(organizationId: string, toolId: string): Promise<boolean> {
    const connectionManager = getConnectionManager();
    try {
      const query = `
        UPDATE "${organizationId}".tools 
        SET is_deployed = FALSE, deployed_state = NULL, deployed_at = NULL
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await connectionManager.query(query, [toolId]);
      return result.length > 0;
    } catch (error) {
      logger.error('Failed to undeploy tool', { organizationId, toolId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  // Close method removed - using centralized connection manager
}

// Export singleton instance
export const postgresManager = new PostgreSQLManager();
