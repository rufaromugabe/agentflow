# API Authentication Patterns Guide

## Overview

This guide explains the different authentication patterns supported by the AgentFlow platform for various APIs, including the fix for Gemini API and other similar APIs.

## Problem Solved

The original issue was that the Gemini API expects the API key to be passed as a **query parameter** (`?key=API_KEY`), not as a header (`X-API-Key`). This guide shows how to configure different APIs with their correct authentication patterns.

## Supported Authentication Patterns

### 1. API Key in Headers (Default)

Most APIs expect the API key in the `X-API-Key` header:

```typescript
const toolConfig = {
  authentication: {
    type: 'api_key',
    config: {
      name: 'X-API-Key',        // Header name
      value: 'your-api-key',    // API key value
      // in: 'header' (default)
    }
  }
};
```

**Examples**: OpenAI API, Anthropic API, most REST APIs

### 2. API Key in Query Parameters

Some APIs (like Gemini) expect the API key as a query parameter:

```typescript
const toolConfig = {
  authentication: {
    type: 'api_key',
    config: {
      name: 'key',              // Query parameter name
      value: 'your-api-key',    // API key value
      in: 'query'               // Specify query parameter
    }
  }
};
```

**Examples**: Google Gemini API, some Google APIs

### 3. Bearer Token Authentication

For OAuth and JWT tokens:

```typescript
const toolConfig = {
  authentication: {
    type: 'bearer',
    config: {
      token: 'your-bearer-token'
    }
  }
};
```

**Examples**: GitHub API, Twitter API, most OAuth APIs

### 4. Basic Authentication

For username/password authentication:

```typescript
const toolConfig = {
  authentication: {
    type: 'basic',
    config: {
      username: 'your-username',
      password: 'your-password'
    }
  }
};
```

**Examples**: Some legacy APIs, internal services

## API-Specific Examples

### Google Gemini API

```typescript
const geminiToolConfig = {
  id: 'gemini-websearch-tool',
  name: 'Gemini Web Search',
  description: 'Search the web using Gemini API',
  apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
  method: 'POST',
  contentType: 'application/json',
  authentication: {
    type: 'api_key',
    config: {
      name: 'key',                    // Query parameter name
      value: 'YOUR_GEMINI_API_KEY',   // Your actual API key
      in: 'query'                     // Must be in query parameters
    }
  },
  metadata: {
    apiType: 'gemini'                 // Special handling for Gemini
  },
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to send to Gemini'
      }
    },
    required: ['text']
  }
};
```

### OpenAI API

```typescript
const openaiToolConfig = {
  id: 'openai-chat-tool',
  name: 'OpenAI Chat',
  description: 'Chat with OpenAI GPT models',
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  method: 'POST',
  contentType: 'application/json',
  authentication: {
    type: 'api_key',
    config: {
      name: 'Authorization',          // Header name
      value: 'Bearer YOUR_OPENAI_KEY', // Bearer token format
      in: 'header'                    // Default, can be omitted
    }
  },
  inputSchema: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        description: 'Array of messages'
      }
    },
    required: ['messages']
  }
};
```

### GitHub API

```typescript
const githubToolConfig = {
  id: 'github-api-tool',
  name: 'GitHub API',
  description: 'Interact with GitHub API',
  apiEndpoint: 'https://api.github.com/user',
  method: 'GET',
  authentication: {
    type: 'bearer',
    config: {
      token: 'YOUR_GITHUB_TOKEN'
    }
  }
};
```

### Custom API with Query Parameters

```typescript
const customToolConfig = {
  id: 'custom-api-tool',
  name: 'Custom API',
  description: 'Custom API that expects API key in query',
  apiEndpoint: 'https://api.example.com/data',
  method: 'GET',
  authentication: {
    type: 'api_key',
    config: {
      name: 'api_key',               // Custom parameter name
      value: 'YOUR_API_KEY',
      in: 'query'                    // Must be in query parameters
    }
  }
};
```

## How the System Works

### 1. URL Building

The system automatically adds API keys to URLs when `in: 'query'` is specified:

```typescript
// For Gemini API
// Original URL: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent
// Final URL: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=YOUR_API_KEY
```

### 2. Header Building

The system only adds API keys to headers when `in: 'header'` (default) or not specified:

```typescript
// For OpenAI API
headers: {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer YOUR_OPENAI_KEY'
}
```

### 3. Special API Handling

The system includes special handling for known APIs:

```typescript
// Special handling for Gemini API
if (config.metadata?.apiType === 'gemini' && config.authentication?.type === 'api_key') {
  const apiKey = config.authentication.config.value || config.authentication.config.apiKey;
  params.append('key', apiKey);
}
```

## Configuration Examples

### Using Templates

```typescript
// Create tool from Gemini template
const geminiTool = await toolBuilder.createToolFromTemplate('gemini-api', {
  id: 'my-gemini-tool',
  name: 'My Gemini Tool',
  authentication: {
    type: 'api_key',
    config: {
      value: 'YOUR_ACTUAL_GEMINI_API_KEY'
    }
  }
});
```

### Direct Configuration

```typescript
// Create tool directly with proper authentication
const tool = await toolBuilder.createTool({
  id: 'my-tool',
  name: 'My Tool',
  description: 'My custom tool',
  apiEndpoint: 'https://api.example.com/endpoint',
  method: 'POST',
  authentication: {
    type: 'api_key',
    config: {
      name: 'key',           // Parameter name
      value: 'API_KEY',      // Your API key
      in: 'query'            // In query parameters
    }
  },
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string' }
    },
    required: ['input']
  }
});
```

## Common API Patterns

### 1. Google APIs
- **Pattern**: Query parameter `key=API_KEY`
- **Example**: Gemini, Google Maps, Google Translate

### 2. OpenAI APIs
- **Pattern**: Header `Authorization: Bearer API_KEY`
- **Example**: GPT, DALL-E, Whisper

### 3. Anthropic APIs
- **Pattern**: Header `x-api-key: API_KEY`
- **Example**: Claude API

### 4. GitHub APIs
- **Pattern**: Header `Authorization: Bearer TOKEN`
- **Example**: GitHub REST API

### 5. Twitter APIs
- **Pattern**: Header `Authorization: Bearer TOKEN`
- **Example**: Twitter API v2

## Troubleshooting

### 1. 403 Forbidden Errors

**Cause**: Incorrect authentication method or API key placement

**Solution**: Check the API documentation and configure the correct authentication pattern:

```typescript
// Wrong - API key in header for Gemini
authentication: {
  type: 'api_key',
  config: {
    name: 'X-API-Key',
    value: 'API_KEY'
    // Missing: in: 'query'
  }
}

// Correct - API key in query for Gemini
authentication: {
  type: 'api_key',
  config: {
    name: 'key',
    value: 'API_KEY',
    in: 'query'
  }
}
```

### 2. 401 Unauthorized Errors

**Cause**: Invalid API key or wrong format

**Solution**: Verify API key format and permissions:

```typescript
// For Bearer tokens, include 'Bearer ' prefix
authentication: {
  type: 'api_key',
  config: {
    name: 'Authorization',
    value: 'Bearer YOUR_TOKEN'  // Note the 'Bearer ' prefix
  }
}
```

### 3. API Key Not Found Errors

**Cause**: API key not being sent in the correct location

**Solution**: Use the health check endpoint to verify configuration:

```bash
GET /agentflow/api/tools/your-tool-id/health
```

## Best Practices

### 1. Use Templates

Always use the provided templates when available:

```typescript
const templates = toolBuilder.getTemplates();
// Look for: gemini-api, openai-api, etc.
```

### 2. Test Authentication

Use the health check endpoint to test your authentication:

```typescript
const healthResult = await toolBuilder.healthCheck('your-tool-id');
console.log(healthResult);
```

### 3. Secure API Keys

Never hardcode API keys in your code. Use environment variables:

```typescript
authentication: {
  type: 'api_key',
  config: {
    value: process.env.GEMINI_API_KEY
  }
}
```

### 4. Monitor Errors

Use the error monitoring system to track authentication issues:

```typescript
const errorStats = errorHandler.getErrorStatistics();
console.log('Authentication errors:', errorStats.byType.AUTHENTICATION_ERROR);
```

## Conclusion

The AgentFlow platform now supports multiple authentication patterns and automatically handles the correct placement of API keys based on the API requirements. The Gemini API issue has been resolved by supporting query parameter authentication, and the system is extensible for other APIs with similar requirements.

Key improvements:
- ✅ **Flexible Authentication**: Support for headers, query parameters, bearer tokens, and basic auth
- ✅ **API-Specific Handling**: Special handling for known APIs like Gemini
- ✅ **Template System**: Pre-configured templates for common APIs
- ✅ **Health Monitoring**: Built-in health checks for authentication testing
- ✅ **Error Handling**: Comprehensive error handling for authentication failures
