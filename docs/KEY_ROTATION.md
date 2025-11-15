# API Key Rotation Guide

This guide explains how to configure and use the automatic API key rotation feature in **ai-orchestrator**. Key rotation helps you:

- **Avoid rate limits** by automatically switching between multiple API keys
- **Maximize throughput** by distributing requests across your key pool
- **Ensure resilience** with automatic fallback and key renewal
- **Stay within usage quotas** with configurable usage limits per key

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Configuration Reference](#configuration-reference)
3. [Use Cases & Examples](#use-cases--examples)
4. [Advanced Features](#advanced-features)
5. [Troubleshooting](#troubleshooting)
6. [Best Practices](#best-practices)

---

## Quick Start

### Basic Key Rotation Setup

The simplest way to enable key rotation is to provide additional API keys for a provider:

```typescript
import { AIOrchestrator } from 'ai-orchestrator';

const orchestrator = new AIOrchestrator({
  providers: [
    {
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      models: [
        { id: 'gpt-4o-mini', type: 'text', cost: 0.15, quality: 'high' }
      ],
      keyRotation: {
        enabled: true,
        usageLimit: 100,  // Rotate after 100 successful requests
        additionalKeys: [
          process.env.OPENAI_API_KEY_2 || '',
          process.env.OPENAI_API_KEY_3 || ''
        ]
      }
    }
  ]
});
```

That's it! The orchestrator will now automatically rotate between your three API keys, switching to the next key after every 100 successful requests.

---

## Configuration Reference

The `keyRotation` configuration object supports the following options:

### Core Options

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `enabled` | `boolean` | No | `true` | Master switch to enable/disable key rotation |
| `usageLimit` | `number` | **Yes** | - | Number of successful requests before rotating to next key |
| `additionalKeys` | `string[]` | No | `[]` | Additional API keys to rotate through (in addition to main `apiKey`) |

### Time-Based Options

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `usageWindowMs` | `number` | No | `undefined` | Time window (in milliseconds) for usage counting. When expired, usage count resets |
| `cooldownMs` | `number` | No | `undefined` | Cooldown period (in milliseconds) before reusing an exhausted key |

### Retry & Resilience Options

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `retryAttempts` | `number` | No | `3` | Number of retry attempts for key renewal |
| `retryDelayMs` | `number` | No | `500` | Delay (in milliseconds) between retry attempts |

### Key Renewal Options

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `renewal` | `KeyRenewalConfig` | No | `undefined` | Configuration for fetching new keys from an endpoint |

#### KeyRenewalConfig

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `endpoint` | `string` | **Yes** | - | URL to fetch new API keys from |
| `method` | `'GET' \| 'POST'` | No | `'GET'` | HTTP method for the renewal request |
| `headers` | `Record<string, string>` | No | `{}` | Custom headers for the renewal request |
| `body` | `any` | No | `undefined` | Request body (for POST requests) |
| `keyPath` | `string` | No | `'apiKey'` | JSON path to extract the key from response (e.g., `'data.apiKey'`) |
| `timeoutMs` | `number` | No | `undefined` | Request timeout in milliseconds |

---

## Use Cases & Examples

### Use Case 1: Simple Round-Robin Rotation

**Scenario:** You have 3 OpenAI API keys and want to distribute load evenly.

```typescript
const config = {
  providers: [
    {
      name: 'openai',
      apiKey: 'sk-key1...',
      models: [{ id: 'gpt-4o-mini', type: 'text', cost: 0.15, quality: 'high' }],
      keyRotation: {
        enabled: true,
        usageLimit: 50,  // Switch after 50 requests
        additionalKeys: ['sk-key2...', 'sk-key3...']
      }
    }
  ]
};
```

**How it works:**
1. First 50 requests use `sk-key1`
2. Next 50 requests use `sk-key2`
3. Next 50 requests use `sk-key3`
4. Then back to `sk-key1` (if its usage window has reset)

---

### Use Case 2: Time-Windowed Usage Limits

**Scenario:** Your API provider allows 1000 requests per hour per key. You want to automatically reset usage counts after each hour.

```typescript
keyRotation: {
  enabled: true,
  usageLimit: 1000,
  usageWindowMs: 60 * 60 * 1000,  // 1 hour in milliseconds
  additionalKeys: ['key2', 'key3']
}
```

**How it works:**
- Each key can make 1000 requests
- After 1 hour, the usage count for that key resets to 0
- If all keys are exhausted, the manager waits and reuses keys after their window expires

---

### Use Case 3: Automatic Rate-Limit Recovery

**Scenario:** Your application occasionally hits rate limits. You want automatic failover to another key.

```typescript
keyRotation: {
  enabled: true,
  usageLimit: 500,
  additionalKeys: ['backup-key-1', 'backup-key-2']
}
```

**How it works:**
- When a `429 Too Many Requests` error occurs, the manager automatically switches to the next available key
- Your application code doesn't need to handle this – the rotation is transparent

---

### Use Case 4: Cooldown Period for Exhausted Keys

**Scenario:** When all keys are exhausted, wait 5 minutes before reusing them.

```typescript
keyRotation: {
  enabled: true,
  usageLimit: 100,
  cooldownMs: 5 * 60 * 1000,  // 5 minutes
  additionalKeys: ['key2', 'key3']
}
```

**How it works:**
- When all 3 keys reach their usage limit
- The manager enforces a 5-minute cooldown before reusing any key
- During cooldown, `getActiveKey()` will wait (blocking) until the cooldown expires

---

### Use Case 5: Dynamic Key Renewal from Your Backend

**Scenario:** You have a backend service that generates temporary API keys. When keys are exhausted, fetch a new one automatically.

```typescript
keyRotation: {
  enabled: true,
  usageLimit: 100,
  additionalKeys: ['key2'],
  renewal: {
    endpoint: 'https://your-backend.com/api/keys/generate',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer your-service-token',
      'Content-Type': 'application/json'
    },
    body: {
      service: 'openai',
      purpose: 'production'
    },
    keyPath: 'data.apiKey',  // Extract from: { data: { apiKey: "sk-..." } }
    timeoutMs: 10000  // 10 second timeout
  }
}
```

**How it works:**
1. When all provided keys are exhausted, the manager makes an HTTP request to your endpoint
2. Extracts the new key from the response using `keyPath`
3. Adds it to the rotation pool
4. If renewal fails after `retryAttempts`, falls back to existing keys with reset usage

---

### Use Case 6: Google Gemini with Multiple Keys

**Scenario:** Using Google's Gemini API with 5 API keys for high-volume applications.

```typescript
const config = {
  providers: [
    {
      name: 'google',
      apiKey: process.env.GOOGLE_API_KEY_1 || '',
      models: [
        { id: 'gemini-1.5-flash-latest', type: 'text', cost: 0.00, quality: 'medium' }
      ],
      keyRotation: {
        enabled: true,
        usageLimit: 1500,
        usageWindowMs: 60 * 1000,  // 1 minute window
        additionalKeys: [
          process.env.GOOGLE_API_KEY_2,
          process.env.GOOGLE_API_KEY_3,
          process.env.GOOGLE_API_KEY_4,
          process.env.GOOGLE_API_KEY_5
        ].filter(Boolean)  // Remove undefined keys
      }
    }
  ]
};
```

---

### Use Case 7: Custom Provider with Key Rotation

**Scenario:** You're using a custom/self-hosted LLM with an API key system.

```typescript
const config = {
  providers: [
    {
      name: 'custom',
      apiKey: 'custom-key-1',
      baseUrl: 'https://your-llm-server.com/v1/completions',
      authenticationHeader: 'X-API-Key',
      models: [
        { id: 'custom-model', type: 'text', cost: 0.01, quality: 'high' }
      ],
      keyRotation: {
        enabled: true,
        usageLimit: 200,
        additionalKeys: ['custom-key-2', 'custom-key-3']
      }
    }
  ]
};
```

---

## Advanced Features

### Thread-Safe Concurrent Requests

The `KeyRotationManager` uses internal locking to ensure thread-safe operation when handling concurrent requests:

```typescript
// All these requests will safely share the same key pool
const results = await Promise.all([
  orchestrator.generate({ type: 'text', prompt: 'Question 1' }),
  orchestrator.generate({ type: 'text', prompt: 'Question 2' }),
  orchestrator.generate({ type: 'text', prompt: 'Question 3' }),
  orchestrator.generate({ type: 'text', prompt: 'Question 4' })
]);
```

**What happens:**
- The manager ensures only one rotation happens at a time
- If multiple concurrent requests trigger rotation (e.g., all hit usage limit), only one rotation executes
- Other requests wait for the rotation to complete, then use the new key

---

### Manual Key Rotation

If you need to manually trigger a key rotation (e.g., for testing or administrative purposes), you can access the underlying manager:

> **Note:** This is an advanced feature. In most cases, automatic rotation is sufficient.

```typescript
// This is not directly exposed in the public API
// but adapters use it internally via keyRotationManager.forceRotate()
```

---

### Logging and Observability

The key rotation system integrates with your logger. Configure it at the orchestrator level:

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty'
  }
});

const orchestrator = new AIOrchestrator({
  providers: [/* ... */],
  logger  // Your custom logger
});
```

**Log Events:**

| Event | Level | Description |
|-------|-------|-------------|
| Key rotation | `info` | Logged when a key is rotated (includes reason and key suffix) |
| All keys exhausted | `warn` | Logged when no keys are available and cooldown is applied |
| Key renewal success | `info` | Logged when a new key is fetched from renewal endpoint |
| Key renewal failure | `error` | Logged when renewal fails after all retries |
| Cooldown wait | `info` | Logged when waiting for cooldown period |

---

## Troubleshooting

### Problem: Keys are rotating too frequently

**Symptoms:**
- Seeing many "Rotated API key" log messages
- Keys exhaust quickly

**Solutions:**
1. **Increase `usageLimit`:**
   ```typescript
   usageLimit: 500  // Instead of 50
   ```
2. **Add more keys:**
   ```typescript
   additionalKeys: ['key2', 'key3', 'key4', 'key5']
   ```
3. **Configure a usage window:**
   ```typescript
   usageWindowMs: 60 * 60 * 1000  // 1 hour
   ```

---

### Problem: "All API keys exhausted" warning

**Symptoms:**
- Log message: "All API keys exhausted; reusing current key after reset"
- Requests may be rate-limited

**Solutions:**
1. **Add more keys** to your rotation pool
2. **Increase usage window:**
   ```typescript
   usageWindowMs: 60 * 60 * 1000  // Allow keys to reset after 1 hour
   ```
3. **Configure key renewal:**
   ```typescript
   renewal: {
     endpoint: 'https://your-api.com/get-new-key'
   }
   ```
4. **Add cooldown period:**
   ```typescript
   cooldownMs: 5 * 60 * 1000  // Wait 5 minutes before reusing
   ```

---

### Problem: Key renewal not working

**Symptoms:**
- "Key renewal failed" error logs
- Keys not being added to the pool

**Diagnostic Steps:**
1. **Check endpoint is reachable:**
   ```bash
   curl https://your-renewal-endpoint.com/api/keys
   ```

2. **Verify response format:**
   ```json
   {
     "apiKey": "sk-new-key..."  // Default keyPath
   }
   ```
   Or configure `keyPath` if your response differs:
   ```typescript
   keyPath: 'data.keys[0].value'  // For nested paths
   ```

3. **Check authentication headers:**
   ```typescript
   renewal: {
     endpoint: '...',
     headers: {
       'Authorization': 'Bearer your-token'  // Ensure token is valid
     }
   }
   ```

4. **Increase timeout:**
   ```typescript
   timeoutMs: 30000  // 30 seconds for slow endpoints
   ```

---

### Problem: Rate limits still occurring

**Symptoms:**
- Still receiving 429 errors despite rotation
- Provider-side rate limiting

**Understanding:**
- Key rotation helps, but doesn't eliminate rate limits if:
  - Your total request rate exceeds provider limits
  - You're using too few keys for your volume
  - Provider has IP-based rate limiting

**Solutions:**
1. **Add more keys**
2. **Reduce request frequency** (add delays between batches)
3. **Use multiple providers:**
   ```typescript
   providers: [
     { name: 'openai', /* ... */ },
     { name: 'google', /* ... */ },  // Fallback provider
   ]
   ```

---

### Problem: TypeScript errors with configuration

**Symptoms:**
- Type errors when configuring `keyRotation`

**Solution:**
Make sure you're importing the types:
```typescript
import { AIOrchestrator, KeyRotationConfig } from 'ai-orchestrator';

const rotationConfig: KeyRotationConfig = {
  enabled: true,
  usageLimit: 100,
  additionalKeys: ['key2']
};
```

---

## Best Practices

### 1. Environment-Based Configuration

Store your API keys securely and load them from environment variables:

```typescript
const config = {
  providers: [
    {
      name: 'openai',
      apiKey: process.env.OPENAI_KEY_1 || '',
      keyRotation: {
        enabled: process.env.NODE_ENV === 'production',  // Only in production
        usageLimit: parseInt(process.env.KEY_ROTATION_LIMIT || '100'),
        additionalKeys: [
          process.env.OPENAI_KEY_2,
          process.env.OPENAI_KEY_3,
          process.env.OPENAI_KEY_4,
        ].filter((key): key is string => !!key)  // Remove undefined values
      }
    }
  ]
};
```

**.env file:**
```bash
OPENAI_KEY_1=sk-...
OPENAI_KEY_2=sk-...
OPENAI_KEY_3=sk-...
KEY_ROTATION_LIMIT=200
```

---

### 2. Monitor Key Usage

Track which keys are being used and when rotations occur:

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'key-rotation.log' })
  ]
});

const orchestrator = new AIOrchestrator({
  providers: [/* ... */],
  logger
});
```

Then analyze your logs to optimize rotation settings.

---

### 3. Test Your Configuration

Before deploying to production, test your rotation setup:

```typescript
import { AIOrchestrator } from 'ai-orchestrator';

async function testRotation() {
  const orchestrator = new AIOrchestrator({
    providers: [{
      name: 'openai',
      apiKey: 'test-key-1',
      keyRotation: {
        enabled: true,
        usageLimit: 2,  // Rotate after just 2 requests for testing
        additionalKeys: ['test-key-2', 'test-key-3']
      },
      models: [{ id: 'gpt-4o-mini', type: 'text', cost: 0.15, quality: 'high' }]
    }]
  });

  // Make several requests to trigger rotation
  for (let i = 0; i < 10; i++) {
    const result = await orchestrator.generate({
      type: 'text',
      prompt: `Test request ${i}`
    });
    console.log(`Request ${i}: ${result.status}`);
  }
}

testRotation();
```

---

### 4. Plan for Scale

Choose your `usageLimit` based on your expected request volume:

| Scenario | Requests/Hour | Keys | Recommended usageLimit |
|----------|---------------|------|------------------------|
| Low volume | < 100 | 1-2 | 50-100 |
| Medium volume | 100-1,000 | 2-3 | 200-500 |
| High volume | 1,000-10,000 | 3-5 | 500-2,000 |
| Very high volume | > 10,000 | 5+ | 1,000-5,000 |

---

### 5. Combine with Other Strategies

Key rotation works great alongside other orchestrator features:

```typescript
const result = await orchestrator.generate({
  type: 'text',
  prompt: 'Complex analysis task',
  strategy: 'cost',     // Use cheapest model
  quality: 'high',      // But ensure high quality
  // Key rotation happens automatically in the background
});
```

---

### 6. Use Renewal for Dynamic Environments

If you're in a cloud environment where keys expire or rotate automatically:

```typescript
keyRotation: {
  enabled: true,
  usageLimit: 1000,
  renewal: {
    endpoint: 'http://metadata.local/api-key',  // Internal metadata service
    method: 'GET',
    keyPath: 'credentials.apiKey',
    timeoutMs: 5000
  }
}
```

This is especially useful in:
- Kubernetes environments with secret rotation
- AWS/GCP/Azure with managed secrets
- Multi-tenant SaaS applications

---

## Summary

The key rotation feature in **ai-orchestrator** provides:

✅ **Automatic failover** on rate limits  
✅ **Load distribution** across multiple keys  
✅ **Zero-downtime** key renewal  
✅ **Thread-safe** concurrent request handling  
✅ **Flexible configuration** for any scale  

Start with the [Quick Start](#quick-start) example, then explore [Use Cases](#use-cases--examples) that match your needs. For production deployments, review the [Best Practices](#best-practices) section.

---

## Adapter Developer Guide

This section is for developers building custom adapters that support key rotation. All built-in adapters (OpenAI, Google, Custom) already implement this pattern.

### Implementation Checklist

Every adapter that supports key rotation should follow these steps:

#### 1. Accept Configuration and Logger

```typescript
interface MyAdapterOptions {
  apiKey: string;
  keyRotation?: KeyRotationConfig;
  logger?: KeyRotationLogger;
}

export class MyAdapter implements IProviderAdapter {
  private keyRotationManager?: KeyRotationManager;
  private currentApiKey: string;
  private readonly logger: KeyRotationLogger;

  constructor(options: MyAdapterOptions) {
    this.currentApiKey = options.apiKey;
    this.logger = options.logger ?? console;
    
    // Initialize key rotation if enabled
    if (options.keyRotation && options.keyRotation.enabled !== false) {
      try {
        this.keyRotationManager = new KeyRotationManager({
          initialKey: options.apiKey,
          config: options.keyRotation,
          logger: this.logger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.warn?.('Failed to initialize key rotation', { message });
      }
    }
  }
}
```

#### 2. Implement Key Resolution

Before each API request, get the active key:

```typescript
private async ensureClient(): Promise<void> {
  if (!this.keyRotationManager) {
    return;
  }
  
  try {
    const activeKey = await this.keyRotationManager.getActiveKey();
    if (activeKey && activeKey !== this.currentApiKey) {
      // Reinitialize your client with the new key
      this.client = new YourSDKClient({ apiKey: activeKey });
      this.currentApiKey = activeKey;
      this.logger?.info?.('Adapter refreshed client with rotated API key', {
        keySuffix: activeKey.slice(-6),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger?.error?.('Failed to acquire API key from rotation manager', { message });
  }
}
```

**Alternative pattern** (for adapters without SDK clients):

```typescript
private async resolveApiKey(): Promise<string | undefined> {
  if (!this.keyRotationManager) {
    return this.currentApiKey;
  }
  
  try {
    return await this.keyRotationManager.getActiveKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger?.error?.('Failed to get active key', { message });
    return this.currentApiKey;
  }
}

// Usage in generate method:
async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
  const apiKey = await this.resolveApiKey();
  const headers = {
    'Authorization': `Bearer ${apiKey}`
  };
  // ... rest of implementation
}
```

#### 3. Record Usage Outcomes

After each API call, record whether it succeeded or hit a rate limit:

```typescript
private async recordUsage(result: 'success' | 'rate-limit'): Promise<void> {
  if (!this.keyRotationManager) {
    return;
  }
  
  try {
    if (result === 'success') {
      await this.keyRotationManager.markSuccess();
    } else {
      await this.keyRotationManager.markRateLimit();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger?.warn?.('Failed to record usage', { result, message });
  }
}
```

#### 4. Detect Rate Limit Errors

Implement a helper to identify rate-limit responses from your provider:

```typescript
private isRateLimitError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  
  // Check for HTTP 429 status
  if (typeof error === 'object') {
    const status = (error as any).status ?? (error as any).httpStatus;
    if (status === 429) {
      return true;
    }
    
    // Check error codes
    const code = (error as any).code;
    if (typeof code === 'string' && /rate[_-]?limit/i.test(code)) {
      return true;
    }
  }
  
  // Check error messages
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error && 'message' in error
        ? String((error as any).message)
        : '';
  
  return /\brate limit\b/i.test(message) || /\b429\b/.test(message);
}
```

#### 5. Integrate Into Request Flow

Put it all together in your generate method:

```typescript
async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
  try {
    // 1. Ensure we have the latest active key
    await this.ensureClient();
    
    // 2. Make the API call
    const response = await this.client.makeRequest(/* ... */);
    
    // 3. Record successful usage
    await this.recordUsage('success');
    
    return {
      status: 'completed',
      provider: 'my-provider',
      model: modelId,
      data: response.data,
    };
  } catch (error: any) {
    // 4. Handle rate limits
    if (this.isRateLimitError(error)) {
      await this.recordUsage('rate-limit');
    }
    
    return {
      status: 'failed',
      provider: 'my-provider',
      model: modelId,
      error: error.message,
    };
  }
}
```

### Complete Example

Here's a minimal but complete adapter implementation:

```typescript
import { KeyRotationManager } from '../utils/keyRotationManager';
import { 
  IProviderAdapter, 
  GenerateRequest, 
  GenerateResult,
  KeyRotationConfig,
  KeyRotationLogger 
} from '../types';

interface MyAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  keyRotation?: KeyRotationConfig;
  logger?: KeyRotationLogger;
}

export class MyAdapter implements IProviderAdapter {
  private baseUrl: string;
  private currentApiKey: string;
  private readonly logger: KeyRotationLogger;
  private keyRotationManager?: KeyRotationManager;

  constructor(options: MyAdapterOptions) {
    if (!options.apiKey) {
      throw new Error('API key is required');
    }
    
    this.baseUrl = options.baseUrl || 'https://api.myprovider.com';
    this.currentApiKey = options.apiKey;
    this.logger = options.logger ?? console;

    // Initialize key rotation
    if (options.keyRotation && options.keyRotation.enabled !== false) {
      try {
        this.keyRotationManager = new KeyRotationManager({
          initialKey: options.apiKey,
          config: options.keyRotation,
          logger: this.logger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.warn?.('Key rotation disabled', { message });
      }
    }
  }

  private async resolveApiKey(): Promise<string> {
    if (!this.keyRotationManager) {
      return this.currentApiKey;
    }
    
    try {
      const key = await this.keyRotationManager.getActiveKey();
      return key || this.currentApiKey;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error?.('Failed to get active key', { message });
      return this.currentApiKey;
    }
  }

  private async recordUsage(result: 'success' | 'rate-limit'): Promise<void> {
    if (!this.keyRotationManager) return;
    
    try {
      if (result === 'success') {
        await this.keyRotationManager.markSuccess();
      } else {
        await this.keyRotationManager.markRateLimit();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn?.('Failed to record usage', { result, message });
    }
  }

  private isRateLimitError(error: unknown): boolean {
    if (!error) return false;
    
    if (typeof error === 'object' && 'status' in error) {
      if ((error as any).status === 429) return true;
    }
    
    const message = 
      typeof error === 'string' ? error :
      typeof error === 'object' && error && 'message' in error ? 
        String((error as any).message) : '';
    
    return /\brate limit\b/i.test(message) || /\b429\b/.test(message);
  }

  async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
    let rateLimitNoted = false;
    
    try {
      const apiKey = await this.resolveApiKey();
      
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          prompt: request.prompt,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          await this.recordUsage('rate-limit');
          rateLimitNoted = true;
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      await this.recordUsage('success');

      return {
        status: 'completed',
        provider: 'my-provider',
        model: modelId,
        data: data.text,
      };
    } catch (error: any) {
      if (!rateLimitNoted && this.isRateLimitError(error)) {
        await this.recordUsage('rate-limit');
      }
      
      return {
        status: 'failed',
        provider: 'my-provider',
        model: modelId,
        error: error.message,
      };
    }
  }
}
```

### Testing Your Implementation

Create tests to verify key rotation works correctly:

```typescript
import { MyAdapter } from './myAdapter';
import { KeyRotationManager } from '../utils/keyRotationManager';

describe('MyAdapter Key Rotation', () => {
  it('rotates to next key when usage limit is reached', async () => {
    const adapter = new MyAdapter({
      apiKey: 'key-1',
      keyRotation: {
        usageLimit: 2,
        additionalKeys: ['key-2', 'key-3']
      }
    });

    // First 2 requests use key-1
    await adapter.generate({ type: 'text', prompt: 'test 1' }, 'model-1');
    await adapter.generate({ type: 'text', prompt: 'test 2' }, 'model-1');
    
    // Third request should trigger rotation to key-2
    const result = await adapter.generate({ type: 'text', prompt: 'test 3' }, 'model-1');
    
    expect(result.status).toBe('completed');
    // Verify key-2 was used (you'll need to expose this for testing)
  });

  it('handles rate limits by rotating keys', async () => {
    // Mock API to return 429 on first call
    const adapter = new MyAdapter({
      apiKey: 'key-1',
      keyRotation: {
        usageLimit: 10,
        additionalKeys: ['key-2']
      }
    });

    // Simulate rate limit response
    // Then verify rotation occurred
  });

  it('handles concurrent requests safely', async () => {
    const adapter = new MyAdapter({
      apiKey: 'key-1',
      keyRotation: {
        usageLimit: 5,
        additionalKeys: ['key-2']
      }
    });

    // Fire multiple concurrent requests
    const results = await Promise.all([
      adapter.generate({ type: 'text', prompt: 'q1' }, 'model-1'),
      adapter.generate({ type: 'text', prompt: 'q2' }, 'model-1'),
      adapter.generate({ type: 'text', prompt: 'q3' }, 'model-1'),
    ]);

    // All should succeed without race conditions
    results.forEach(result => {
      expect(result.status).toBe('completed');
    });
  });
});
```

### Important Notes

1. **Always wrap in try-catch**: Key rotation initialization can fail, so always handle errors gracefully
2. **Don't throw on rotation errors**: If rotation fails, fall back to the current key
3. **Track rate-limit recording**: Use a flag to avoid recording the same rate limit multiple times
4. **Thread safety**: The `KeyRotationManager` handles locking internally, but don't try to manage it yourself
5. **Logging**: Always provide meaningful log messages with context

### Reference Implementations

Check these adapters for complete, production-ready examples:

- **OpenAI Adapter**: [`src/adapters/openai.ts`](../src/adapters/openai.ts)
- **Google Adapter**: [`src/adapters/google.ts`](../src/adapters/google.ts)
- **Custom Adapter**: [`src/adapters/custom.ts`](../src/adapters/custom.ts)

---

## Additional Resources

- [Main README](../README.md) - Core orchestrator documentation
- [API Reference](./API.md) - Full TypeScript API (if exists)
- [Examples](../examples/) - Working code examples
- [GitHub Issues](https://github.com/yourusername/ai-orchestrator/issues) - Report bugs or request features

---

**Need help?** Open an issue on GitHub or check our [troubleshooting guide](#troubleshooting).

