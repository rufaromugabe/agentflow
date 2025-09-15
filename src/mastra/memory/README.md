# Organization Memory System

This module provides a PostgreSQL-based memory system for Mastra agents, designed to work with organization-based schemas where each organization has its own database schema.

## Features

- **Organization-based isolation**: Each organization gets its own PostgreSQL schema
- **PostgreSQL storage**: Uses `@mastra/pg` for reliable data persistence
- **Vector embeddings**: Uses `@mastra/fastembed` for semantic search capabilities
- **Multiple memory types**: Thread-based, resource-based, and working memory
- **Automatic schema creation**: Creates all necessary tables and indexes
- **Memory management**: Centralized memory manager per organization

## Architecture

### Database Schema

Each organization gets its own PostgreSQL schema with the following tables:

- `threads`: Conversation threads with titles and metadata
- `messages`: Individual messages within threads
- `message_embeddings`: Vector embeddings for semantic search
- `resources`: Resource entities for resource-scoped memory
- `resource_messages`: Links between resources and messages
- `working_memory`: Temporary memory storage with expiration

### Memory Types

1. **Thread Memory**: Conversation-based memory within a specific thread
2. **Resource Memory**: User or entity-based memory across multiple threads
3. **Working Memory**: Temporary memory with expiration for short-term context

## Usage

### Basic Setup

```typescript
import { createDynamicAgentBuilder } from "../agents/dynamic-agent-builder";

const organizationId = "your-org-id";
const agentBuilder = createDynamicAgentBuilder(organizationId);

// Initialize the system (creates schema and tables)
await agentBuilder.initialize();
```

### Creating an Agent with Memory

```typescript
const agentConfig = {
  id: "memory-agent-001",
  name: "Memory Agent",
  description: "An agent with PostgreSQL memory",
  instructions: "You are an AI agent with memory capabilities.",
  model: "gpt-4o-mini",
  tools: [],
  memory: {
    enabled: true,
    storage: "postgresql"
  },
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
};

const agent = await agentBuilder.createAgent(agentConfig);
```

### Using Memory in Conversations

```typescript
// Basic memory usage
const response = await agent.stream("Hello, I'm John.", {
  memory: {
    thread: "conversation-123",
    resource: "user-456"
  }
});

// With memory options
const responseWithOptions = await agent.stream("What do you remember about me?", {
  memory: {
    thread: "conversation-123",
    resource: "user-456"
  },
  memoryOptions: {
    lastMessages: 10,
    semanticRecall: {
      topK: 5,
      messageRange: 3
    }
  }
});
```

## Configuration Options

### Memory Options

- `lastMessages`: Number of recent messages to include (default: 10)
- `semanticRecall`: Enable semantic search with options:
  - `topK`: Number of similar messages to retrieve (default: 3)
  - `messageRange`: Number of neighboring messages to include (default: 2)
- `workingMemory`: Enable working memory (default: true)
- `scope`: Memory scope - 'thread', 'resource', or 'organization' (default: 'resource')
- `generateTitle`: Auto-generate thread titles (default: true)

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/database

# Optional
OPENAI_API_KEY=your-openai-key  # For embeddings if using OpenAI
```

## Memory Manager

The `OrganizationMemoryManager` provides centralized memory management:

```typescript
import { getMemoryManager } from "./organization-memory";

const memoryManager = getMemoryManager(organizationId);

// Get agent memory
const memory = memoryManager.getAgentMemory(agentId, agentName, options);

// Get statistics
const stats = await memoryManager.getMemoryStats();

// Initialize organization memory
await memoryManager.initialize();
```

## Database Schema Details

### Threads Table
```sql
CREATE TABLE "organization_id".threads (
  id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(500),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Messages Table
```sql
CREATE TABLE "organization_id".messages (
  id VARCHAR(255) PRIMARY KEY,
  thread_id VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES "organization_id".threads(id) ON DELETE CASCADE
);
```

### Message Embeddings Table
```sql
CREATE TABLE "organization_id".message_embeddings (
  id VARCHAR(255) PRIMARY KEY,
  message_id VARCHAR(255) NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES "organization_id".messages(id) ON DELETE CASCADE
);
```

## Examples

See the example files:
- `src/examples/memory-example.ts` - Basic memory usage
- `src/examples/advanced-memory-example.ts` - Advanced configurations

## Dependencies

- `@mastra/memory`: Core memory functionality
- `@mastra/pg`: PostgreSQL storage and vector support
- `@mastra/fastembed`: Local embeddings generation
- `pg`: PostgreSQL client

## Best Practices

1. **Organization Isolation**: Always use unique organization IDs to ensure data isolation
2. **Memory Scope**: Choose appropriate memory scope based on use case:
   - `thread`: For conversation-specific context
   - `resource`: For user/entity-specific context across conversations
   - `organization`: For organization-wide context
3. **Semantic Recall**: Use semantic recall for finding relevant past conversations
4. **Memory Limits**: Set appropriate `lastMessages` limits to control context size
5. **Error Handling**: Always handle memory initialization errors gracefully

## Troubleshooting

### Common Issues

1. **Schema Creation Fails**: Ensure the database user has CREATE SCHEMA permissions
2. **Vector Extension Missing**: Install pgvector extension in PostgreSQL
3. **Memory Not Working**: Check that memory is enabled in agent configuration
4. **Performance Issues**: Consider adding more indexes or adjusting memory options

### Debug Mode

Enable debug logging by setting:
```bash
DEBUG=mastra:memory:*
```
