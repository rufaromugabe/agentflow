// Centralized database connection management
import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';
import { AgentFlowError, retry } from '../utils/helpers';

export interface DatabaseConfig {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

class DatabaseConnectionManager {
  private pool: Pool | null = null;
  private config: DatabaseConfig;
  private isInitialized = false;

  constructor(config: DatabaseConfig) {
    this.config = {
      maxConnections: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ...config
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Database connection manager already initialized');
      return;
    }

    try {
      logger.info('Initializing database connection', { 
        connectionString: this.config.connectionString.replace(/\/\/.*@/, '//***:***@') // Hide credentials in logs
      });

      this.pool = new Pool({
        connectionString: this.config.connectionString,
        max: this.config.maxConnections,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis,
      });

      // Test the connection with retry logic
      await this.testConnectionWithRetry();
      
      this.isInitialized = true;
      logger.info('Database connection manager initialized successfully', {
        maxConnections: this.config.maxConnections
      });
    } catch (error) {
      logger.error('Failed to initialize database connection manager', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        connectionString: this.config.connectionString.replace(/\/\/.*@/, '//***:***@')
      }, error instanceof Error ? error : undefined);
      
      // Provide more helpful error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new AgentFlowError(
        `Database initialization failed: ${errorMessage}`,
        'DATABASE_INIT_ERROR',
        { 
          connectionString: this.config.connectionString.replace(/\/\/.*@/, '//***:***@'),
          originalError: errorMessage
        },
        500
      );
    }
  }

  private async testConnectionWithRetry(): Promise<void> {
    if (!this.pool) {
      throw new AgentFlowError('Database pool not initialized', 'DATABASE_NOT_INITIALIZED');
    }

    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        try {
          await client.query('SELECT 1');
          logger.debug('Database connection test successful', { attempt });
          return;
        } finally {
          client.release();
        }
      } catch (error) {
        logger.warn(`Database connection test failed (attempt ${attempt}/${maxRetries})`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  private async testConnection(): Promise<void> {
    if (!this.pool) {
      throw new AgentFlowError('Database pool not initialized', 'DATABASE_NOT_INITIALIZED');
    }

    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      logger.debug('Database connection test successful');
    } finally {
      client.release();
    }
  }

  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new AgentFlowError('Database pool not initialized', 'DATABASE_NOT_INITIALIZED');
    }

    try {
      return await this.pool.connect();
    } catch (error) {
      logger.error('Failed to get database client', undefined, error instanceof Error ? error : undefined);
      throw new AgentFlowError(
        'Failed to get database client',
        'DATABASE_CLIENT_ERROR',
        undefined,
        500
      );
    }
  }

  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    if (!this.pool) {
      throw new AgentFlowError('Database pool not initialized', 'DATABASE_NOT_INITIALIZED');
    }

    try {
      const result = await this.pool.query(text, params);
      return result.rows;
    } catch (error) {
      logger.error('Database query failed', { query: text, params }, error instanceof Error ? error : undefined);
      throw new AgentFlowError(
        'Database query failed',
        'DATABASE_QUERY_ERROR',
        { query: text },
        500
      );
    }
  }

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction failed, rolled back', undefined, error instanceof Error ? error : undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createSchemaIfNotExists(schemaName: string): Promise<void> {
    const normalizedSchema = schemaName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (normalizedSchema !== schemaName) {
      logger.warn('Schema name normalized', { original: schemaName, normalized: normalizedSchema });
    }

    await this.query(`CREATE SCHEMA IF NOT EXISTS "${normalizedSchema}"`);
    logger.debug('Schema created or verified', { schema: normalizedSchema });
  }

  async createExtensionIfNotExists(extensionName: string, schemaName?: string): Promise<void> {
    const schemaClause = schemaName ? `SCHEMA "${schemaName}"` : '';
    await this.query(`CREATE EXTENSION IF NOT EXISTS ${extensionName} ${schemaClause}`);
    logger.debug('Extension created or verified', { extension: extensionName, schema: schemaName });
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isInitialized = false;
      logger.info('Database connection pool closed');
    }
  }

  getPool(): Pool | null {
    return this.pool;
  }

  isReady(): boolean {
    return this.isInitialized && this.pool !== null;
  }

  getStats(): { totalCount: number; idleCount: number; waitingCount: number } {
    if (!this.pool) {
      return { totalCount: 0, idleCount: 0, waitingCount: 0 };
    }

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount
    };
  }
}

// Singleton instance
let connectionManager: DatabaseConnectionManager | null = null;

export function getConnectionManager(): DatabaseConnectionManager {
  if (!connectionManager) {
    const connectionString = process.env.DATABASE_URL || 'postgresql://user:none@localhost:5432/agentflow';
    
    // Log the connection string being used (with credentials hidden)
    logger.info('Using database connection', { 
      connectionString: connectionString.replace(/\/\/.*@/, '//***:***@'),
      hasEnvVar: !!process.env.DATABASE_URL
    });
    
    connectionManager = new DatabaseConnectionManager({ connectionString });
  }
  return connectionManager;
}

export async function initializeDatabase(): Promise<void> {
  const manager = getConnectionManager();
  await manager.initialize();
}

export async function closeDatabase(): Promise<void> {
  if (connectionManager) {
    await connectionManager.close();
    connectionManager = null;
  }
}
