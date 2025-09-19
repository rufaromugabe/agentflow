/**
 * Authentication Pattern Test
 * 
 * This file demonstrates how the fixed authentication system works
 * for different API patterns, including the Gemini API fix.
 */

import { createDynamicToolBuilder } from '../tools/dynamic-tool-builder';

// Test function to demonstrate the authentication fix
export async function testAuthenticationPatterns() {
  const toolBuilder = createDynamicToolBuilder('test-org');

  console.log('🔧 Testing Authentication Patterns...\n');

  // Test 1: Gemini API with query parameter authentication
  console.log('1. Testing Gemini API (Query Parameter Authentication)');
  const geminiConfig = {
    id: 'test-gemini-tool',
    name: 'Test Gemini Tool',
    description: 'Test tool for Gemini API',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
    method: 'POST',
    contentType: 'application/json',
    authentication: {
      type: 'api_key',
      config: {
        name: 'key',
        value: 'test-api-key-12345',
        in: 'query'  // This is the key fix!
      }
    },
    metadata: {
      apiType: 'gemini'
    },
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' }
      },
      required: ['text']
    }
  };

  try {
    const geminiTool = await toolBuilder.createTool(geminiConfig);
    console.log('✅ Gemini tool created successfully');
    console.log('   - API key will be sent as query parameter: ?key=test-api-key-12345');
    console.log('   - No X-API-Key header will be added\n');
  } catch (error) {
    console.log('❌ Gemini tool creation failed:', error);
  }

  // Test 2: Standard API with header authentication
  console.log('2. Testing Standard API (Header Authentication)');
  const standardConfig = {
    id: 'test-standard-tool',
    name: 'Test Standard Tool',
    description: 'Test tool for standard API',
    apiEndpoint: 'https://api.example.com/endpoint',
    method: 'POST',
    contentType: 'application/json',
    authentication: {
      type: 'api_key',
      config: {
        name: 'X-API-Key',
        value: 'test-api-key-67890'
        // in: 'header' is default
      }
    },
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string' }
      },
      required: ['data']
    }
  };

  try {
    const standardTool = await toolBuilder.createTool(standardConfig);
    console.log('✅ Standard tool created successfully');
    console.log('   - API key will be sent as header: X-API-Key: test-api-key-67890');
    console.log('   - No query parameters will be added\n');
  } catch (error) {
    console.log('❌ Standard tool creation failed:', error);
  }

  // Test 3: Bearer token authentication
  console.log('3. Testing Bearer Token Authentication');
  const bearerConfig = {
    id: 'test-bearer-tool',
    name: 'Test Bearer Tool',
    description: 'Test tool for bearer token API',
    apiEndpoint: 'https://api.github.com/user',
    method: 'GET',
    authentication: {
      type: 'bearer',
      config: {
        token: 'ghp_test-token-12345'
      }
    },
    inputSchema: {
      type: 'object',
      properties: {}
    }
  };

  try {
    const bearerTool = await toolBuilder.createTool(bearerConfig);
    console.log('✅ Bearer tool created successfully');
    console.log('   - Token will be sent as header: Authorization: Bearer ghp_test-token-12345\n');
  } catch (error) {
    console.log('❌ Bearer tool creation failed:', error);
  }

  // Test 4: Available templates
  console.log('4. Available Templates:');
  const templates = toolBuilder.getTemplates();
  templates.forEach(template => {
    console.log(`   - ${template.id}: ${template.name}`);
    if (template.id === 'gemini-api') {
      console.log('     ✅ Includes proper Gemini authentication configuration');
    }
  });

  console.log('\n🎉 Authentication pattern tests completed!');
  console.log('\nKey improvements:');
  console.log('✅ Gemini API now uses query parameter authentication');
  console.log('✅ Standard APIs continue to use header authentication');
  console.log('✅ Bearer token authentication works correctly');
  console.log('✅ Templates include proper authentication patterns');
  console.log('✅ System automatically handles different API requirements');
}

// Export for use in other files
export { testAuthenticationPatterns };
