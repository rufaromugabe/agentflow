import { DatabaseSchema, AgentTable, ToolTable, ToolTemplateTable, AgentExecutionTable, ToolExecutionTable, AnalyticsTable } from '../types';
import { safeJsonParse } from '../utils/helpers';

// Database schema implementation following the memory about organization-based schemas
export class DatabaseSchemaManager {
  private schemas: Map<string, DatabaseSchema> = new Map();

  constructor() {
    this.initializeDefaultSchema();
  }

  private initializeDefaultSchema() {
    // Default schema for the main organization
    const defaultSchema: DatabaseSchema = {
      name: 'default', // This would be the organization ID
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

  // SQL DDL for creating tables
  generateCreateTableSQL(organizationId: string): string[] {
    const schema = this.getSchema(organizationId);
    if (!schema) {
      throw new Error(`Schema not found for organization: ${organizationId}`);
    }

    const sqlStatements: string[] = [];

    // Create agents table
    sqlStatements.push(`
      CREATE TABLE IF NOT EXISTS ${schema.name}.agents (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        instructions TEXT NOT NULL,
        model VARCHAR(100) NOT NULL,
        tools JSON,
        memory_config JSON,
        voice_config JSON,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        workspace_id VARCHAR(255),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        INDEX idx_workspace_id (workspace_id)
      );
    `);

    // Create tools table
    sqlStatements.push(`
      CREATE TABLE IF NOT EXISTS ${schema.name}.tools (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        input_schema JSON NOT NULL,
        output_schema JSON,
        api_endpoint VARCHAR(500),
        method VARCHAR(10),
        headers JSON,
        authentication JSON,
        rate_limit JSON,
        timeout INT,
        retries INT,
        cache_config JSON,
        validation_config JSON,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        workspace_id VARCHAR(255),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        INDEX idx_workspace_id (workspace_id)
      );
    `);

    // Create tool_templates table
    sqlStatements.push(`
      CREATE TABLE IF NOT EXISTS ${schema.name}.tool_templates (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        template JSON NOT NULL,
        examples JSON,
        tags JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category (category),
        INDEX idx_created_at (created_at)
      );
    `);

    // Create agent_executions table
    sqlStatements.push(`
      CREATE TABLE IF NOT EXISTS ${schema.name}.agent_executions (
        id VARCHAR(255) PRIMARY KEY,
        agent_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        organization_id VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        response TEXT,
        usage JSON,
        finish_reason VARCHAR(50),
        tool_calls JSON,
        execution_time INT,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_agent_id (agent_id),
        INDEX idx_user_id (user_id),
        INDEX idx_organization_id (organization_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      );
    `);

    // Create tool_executions table
    sqlStatements.push(`
      CREATE TABLE IF NOT EXISTS ${schema.name}.tool_executions (
        id VARCHAR(255) PRIMARY KEY,
        tool_id VARCHAR(255) NOT NULL,
        agent_id VARCHAR(255),
        user_id VARCHAR(255) NOT NULL,
        organization_id VARCHAR(255) NOT NULL,
        input JSON NOT NULL,
        output JSON,
        execution_time INT,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        cache_hit BOOLEAN DEFAULT FALSE,
        retries INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tool_id (tool_id),
        INDEX idx_agent_id (agent_id),
        INDEX idx_user_id (user_id),
        INDEX idx_organization_id (organization_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      );
    `);

    // Create analytics table
    sqlStatements.push(`
      CREATE TABLE IF NOT EXISTS ${schema.name}.analytics (
        id VARCHAR(255) PRIMARY KEY,
        agent_id VARCHAR(255),
        tool_id VARCHAR(255),
        user_id VARCHAR(255) NOT NULL,
        organization_id VARCHAR(255) NOT NULL,
        metric_type VARCHAR(50) NOT NULL,
        metric_value DECIMAL(10,2) NOT NULL,
        metadata JSON,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_agent_id (agent_id),
        INDEX idx_tool_id (tool_id),
        INDEX idx_user_id (user_id),
        INDEX idx_organization_id (organization_id),
        INDEX idx_metric_type (metric_type),
        INDEX idx_timestamp (timestamp)
      );
    `);

    return sqlStatements;
  }

  // Migration scripts for schema updates
  generateMigrationSQL(fromVersion: string, toVersion: string, organizationId: string): string[] {
    const migrations: string[] = [];

    // Example migration from v1.0 to v1.1
    if (fromVersion === '1.0' && toVersion === '1.1') {
      migrations.push(`
        ALTER TABLE ${organizationId}.agents 
        ADD COLUMN workspace_id VARCHAR(255) AFTER metadata;
      `);
      
      migrations.push(`
        ALTER TABLE ${organizationId}.tools 
        ADD COLUMN workspace_id VARCHAR(255) AFTER metadata;
      `);
      
      migrations.push(`
        CREATE INDEX idx_workspace_id ON ${organizationId}.agents (workspace_id);
      `);
      
      migrations.push(`
        CREATE INDEX idx_workspace_id ON ${organizationId}.tools (workspace_id);
      `);
    }

    return migrations;
  }

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
}

// Database connection and query utilities
export class DatabaseManager {
  private schemaManager: DatabaseSchemaManager;

  constructor() {
    this.schemaManager = new DatabaseSchemaManager();
  }

  // Initialize database for an organization
  async initializeOrganization(organizationId: string): Promise<void> {
    // Create schema if it doesn't exist
    if (!this.schemaManager.getSchema(organizationId)) {
      this.schemaManager.createOrganizationSchema(organizationId);
    }

    // Execute create table statements
    const createStatements = this.schemaManager.generateCreateTableSQL(organizationId);
    
    // This would be implemented with your actual database connection
    // For example, with MySQL, PostgreSQL, etc.
    for (const statement of createStatements) {
      await this.executeSQL(statement);
    }
  }

  // Generic CRUD operations for agents
  async createAgent(organizationId: string, agentData: Partial<AgentTable>): Promise<AgentTable> {
    const agent: AgentTable = {
      id: agentData.id || `agent-${Date.now()}`,
      name: agentData.name || '',
      description: agentData.description || '',
      instructions: agentData.instructions || '',
      model: agentData.model || 'gpt-4o-mini',
      tools: agentData.tools || [],
      memory_config: agentData.memory_config,
      voice_config: agentData.voice_config,
      status: agentData.status || 'active',
      metadata: agentData.metadata,
      created_at: new Date(),
      updated_at: new Date(),
      workspace_id: agentData.workspace_id,
    };

    const sql = `
      INSERT INTO ${organizationId}.agents 
      (id, name, description, instructions, model, tools, memory_config, voice_config, status, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.executeSQL(sql, [
      agent.id,
      agent.name,
      agent.description,
      agent.instructions,
      agent.model,
      JSON.stringify(agent.tools),
      agent.memory_config ? JSON.stringify(agent.memory_config) : null,
      agent.voice_config ? JSON.stringify(agent.voice_config) : null,
      agent.status,
      agent.metadata ? JSON.stringify(agent.metadata) : null,
      agent.workspace_id,
    ]);

    return agent;
  }

  async getAgent(organizationId: string, agentId: string): Promise<AgentTable | null> {
    const sql = `SELECT * FROM ${organizationId}.agents WHERE id = ?`;
    const result = await this.executeSQL(sql, [agentId]);
    
    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      model: row.model,
      tools: safeJsonParse(row.tools, []) || [],
      memory_config: safeJsonParse(row.memory_config, undefined) || undefined,
      voice_config: safeJsonParse(row.voice_config, undefined) || undefined,
      status: row.status,
      metadata: safeJsonParse(row.metadata, undefined) || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      workspace_id: row.workspace_id,
    };
  }

  async updateAgent(organizationId: string, agentId: string, updates: Partial<AgentTable>): Promise<AgentTable | null> {
    const existingAgent = await this.getAgent(organizationId, agentId);
    if (!existingAgent) {
      return null;
    }

    const updatedAgent = {
      ...existingAgent,
      ...updates,
      updated_at: new Date(),
    };

    const sql = `
      UPDATE ${organizationId}.agents 
      SET name = ?, description = ?, instructions = ?, model = ?, tools = ?, 
          memory_config = ?, voice_config = ?, status = ?, metadata = ?, 
          workspace_id = ?, updated_at = ?
      WHERE id = ?
    `;

    await this.executeSQL(sql, [
      updatedAgent.name,
      updatedAgent.description,
      updatedAgent.instructions,
      updatedAgent.model,
      JSON.stringify(updatedAgent.tools),
      updatedAgent.memory_config ? JSON.stringify(updatedAgent.memory_config) : null,
      updatedAgent.voice_config ? JSON.stringify(updatedAgent.voice_config) : null,
      updatedAgent.status,
      updatedAgent.metadata ? JSON.stringify(updatedAgent.metadata) : null,
      updatedAgent.workspace_id,
      updatedAgent.updated_at,
      agentId,
    ]);

    return updatedAgent;
  }

  async deleteAgent(organizationId: string, agentId: string): Promise<boolean> {
    const sql = `DELETE FROM ${organizationId}.agents WHERE id = ?`;
    const result = await this.executeSQL(sql, [agentId]);
    return result.affectedRows > 0;
  }

  async listAgents(organizationId: string, workspaceId?: string): Promise<AgentTable[]> {
    let sql = `SELECT * FROM ${organizationId}.agents`;
    const params: any[] = [];

    if (workspaceId) {
      sql += ' WHERE workspace_id = ?';
      params.push(workspaceId);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await this.executeSQL(sql, params);
    
    return result.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      model: row.model,
      tools: safeJsonParse(row.tools, []) || [],
      memory_config: safeJsonParse(row.memory_config, undefined) || undefined,
      voice_config: safeJsonParse(row.voice_config, undefined) || undefined,
      status: row.status,
      metadata: safeJsonParse(row.metadata, undefined) || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      workspace_id: row.workspace_id,
    }));
  }

  // Similar CRUD operations for tools, executions, and analytics would be implemented here

  // Placeholder for actual database execution
  private async executeSQL(sql: string, params: any[] = []): Promise<any> {
    // This would be implemented with your actual database connection
    // For example:
    // - MySQL with mysql2
    // - PostgreSQL with pg
    // - SQLite with better-sqlite3
    // - etc.
    
    console.log('Executing SQL:', sql, 'with params:', params);
    
    // Placeholder return
    return [];
  }
}

// Export singleton instances
export const schemaManager = new DatabaseSchemaManager();
export const databaseManager = new DatabaseManager();
