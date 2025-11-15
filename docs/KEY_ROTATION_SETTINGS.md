# Key Rotation Settings Reference

Complete reference for all configuration options available in the `KeyRotationConfig` interface.

---

## Table of Contents

1. [Core Settings](#core-settings)
2. [Time-Based Settings](#time-based-settings)
3. [Retry & Resilience Settings](#retry--resilience-settings)
4. [Key Renewal Configuration](#key-renewal-configuration)
5. [Practical Examples](#practical-examples)

---

## Core Settings

These are the fundamental settings that control basic key rotation behavior.

### `enabled`

- **Type:** `boolean`
- **Required:** No
- **Default:** `true`
- **What it does:** Master on/off switch for the entire key rotation feature.

```typescript
keyRotation: {
  enabled: false  // Completely disables rotation
}
```

---

### `usageLimit`

- **Type:** `number`
- **Required:** **Yes**
- **What it does:** Number of **successful** API requests before automatically rotating to the next key.

```typescript
keyRotation: {
  usageLimit: 100  // Rotate after 100 successful requests
}
```

> ⚠️ **Note:** Only successful requests count. Failed requests don't increment the counter.

---

### `additionalKeys`

- **Type:** `string[]` (array of API keys)
- **Required:** No
- **Default:** `[]`
- **What it does:** Additional API keys to rotate through (beyond the main `apiKey`).

```typescript
apiKey: 'key-1',  // Main key (always included)
keyRotation: {
  usageLimit: 100,
  additionalKeys: ['key-2', 'key-3', 'key-4']  // 4 total keys
}
```

**Rotation order:** key-1 → key-2 → key-3 → key-4 → key-1 (cycles back)

---

## Time-Based Settings

Configure time windows and cooldown periods for more sophisticated rotation strategies.

### `usageWindowMs`

- **Type:** `number` (milliseconds)
- **Required:** No
- **Default:** `undefined`
- **What it does:** Time window for usage counting. After this time expires, the usage count for a key resets to 0.

```typescript
keyRotation: {
  usageLimit: 1000,
  usageWindowMs: 60 * 60 * 1000  // 1 hour = 3,600,000 ms
}
```

**Behavior:** Each key can make 1000 requests per hour. After 1 hour, it can make another 1000.

> 💡 **Perfect for providers with hourly/daily quotas!**

> ⚠️ **Without this setting:** Once a key hits the limit, it won't reset until you cycle through all keys.

---

### `cooldownMs`

- **Type:** `number` (milliseconds)
- **Required:** No
- **Default:** `undefined`
- **What it does:** Waiting period before reusing an exhausted key when all keys are depleted.

```typescript
keyRotation: {
  usageLimit: 100,
  cooldownMs: 5 * 60 * 1000  // 5 minutes = 300,000 ms
}
```

**Behavior:**
1. All 3 keys reach their limit
2. Manager waits 5 minutes
3. Resets usage and allows requests again

---

## Retry & Resilience Settings

Control retry behavior when fetching new keys from renewal endpoints.

### `retryAttempts`

- **Type:** `number`
- **Required:** No
- **Default:** `3`
- **What it does:** Number of retry attempts when fetching a new key from the renewal endpoint.

```typescript
keyRotation: {
  usageLimit: 100,
  retryAttempts: 5,  // Try 5 times before giving up
  renewal: { /* ... */ }
}
```

> 📌 **Note:** Only used when `renewal` is configured.

---

### `retryDelayMs`

- **Type:** `number` (milliseconds)
- **Required:** No
- **Default:** `500`
- **What it does:** Delay between retry attempts when renewal fails.

```typescript
keyRotation: {
  usageLimit: 100,
  retryAttempts: 3,
  retryDelayMs: 2000,  // Wait 2 seconds between each retry
  renewal: { /* ... */ }
}
```

---

## Key Renewal Configuration

Dynamically fetch new API keys from an HTTP endpoint when all keys are exhausted.

### `renewal`

- **Type:** `KeyRenewalConfig` object
- **Required:** No
- **Default:** `undefined`
- **What it does:** Configuration for fetching new API keys from an HTTP endpoint.

```typescript
keyRotation: {
  usageLimit: 100,
  additionalKeys: ['key-2'],
  renewal: {
    endpoint: 'https://your-backend.com/api/get-key',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer your-service-token'
    },
    body: {
      service: 'openai',
      environment: 'production'
    },
    keyPath: 'data.apiKey',
    timeoutMs: 10000
  }
}
```

---

### Renewal Sub-Properties

#### `endpoint` (Required)

- **Type:** `string`
- **What it does:** URL to fetch new API keys from.

```typescript
endpoint: 'https://api.yourcompany.com/keys/generate'
```

---

#### `method`

- **Type:** `'GET' | 'POST'`
- **Required:** No
- **Default:** `'GET'`
- **What it does:** HTTP method for the renewal request.

```typescript
method: 'POST'
```

---

#### `headers`

- **Type:** `Record<string, string>`
- **Required:** No
- **What it does:** Custom headers for authentication.

```typescript
headers: {
  'Authorization': 'Bearer token123',
  'X-Custom-Header': 'value'
}
```

---

#### `body`

- **Type:** `any`
- **Required:** No
- **What it does:** Request body (for POST requests).

```typescript
body: {
  provider: 'openai',
  purpose: 'production'
}
```

---

#### `keyPath`

- **Type:** `string`
- **Required:** No
- **Default:** `'apiKey'`
- **What it does:** JSON path to extract the key from response (supports nested paths and arrays).

```typescript
// For response: { data: { apiKey: "sk-..." } }
keyPath: 'data.apiKey'

// For response: { keys: [{ value: "sk-..." }] }
keyPath: 'keys[0].value'
```

---

#### `timeoutMs`

- **Type:** `number` (milliseconds)
- **Required:** No
- **What it does:** Request timeout in milliseconds.

```typescript
timeoutMs: 15000  // 15 second timeout
```

---

## Practical Examples

### Example 1: Simple Round-Robin Rotation

Most common use case - distribute load evenly across multiple keys.

```typescript
keyRotation: {
  usageLimit: 100,
  additionalKeys: ['key-2', 'key-3']
}

// Flow:
// - First 100 requests use key-1
// - Next 100 requests use key-2
// - Next 100 requests use key-3
// - Then back to key-1
```

---

### Example 2: Time-Windowed Usage Limits

Perfect for hourly or daily API quotas.

```typescript
keyRotation: {
  usageLimit: 1000,
  usageWindowMs: 60 * 60 * 1000,  // 1 hour
  additionalKeys: ['key-2', 'key-3']
}

// Behavior:
// - Each key can make 1000 requests per hour
// - After 1 hour, usage count resets
// - Allows sustained high throughput
```

---

### Example 3: With Cooldown Period

Wait before reusing exhausted keys.

```typescript
keyRotation: {
  usageLimit: 50,
  cooldownMs: 10 * 60 * 1000,  // 10 minutes
  additionalKeys: ['key-2', 'key-3', 'key-4', 'key-5']
}

// Behavior:
// - Each key handles 50 requests
// - If all 5 keys exhausted, wait 10 minutes
// - Then reuse with reset counters
```

---

### Example 4: Dynamic Key Renewal

Fetch new keys from your backend when needed.

```typescript
keyRotation: {
  usageLimit: 500,
  additionalKeys: ['key-2'],
  retryAttempts: 5,
  retryDelayMs: 1000,
  renewal: {
    endpoint: 'https://api.yourcompany.com/keys/generate',
    method: 'POST',
    headers: {
      'X-API-Token': 'your-internal-token'
    },
    keyPath: 'key',
    timeoutMs: 15000
  }
}

// Behavior:
// - Start with 2 keys
// - When both exhausted, fetch new key from endpoint
// - Retry up to 5 times with 1 second delay
// - Add new key to pool and continue rotating
```

---

### Example 5: Complete Configuration

All settings working together.

```typescript
const orchestrator = new AIOrchestrator({
  providers: [
    {
      name: 'openai',
      apiKey: 'sk-key-1',
      models: [
        { id: 'gpt-4o-mini', type: 'text', cost: 0.15, quality: 'high' }
      ],
      keyRotation: {
        enabled: true,
        usageLimit: 1000,
        usageWindowMs: 3600000,    // 1 hour
        cooldownMs: 300000,        // 5 minutes
        retryAttempts: 3,
        retryDelayMs: 2000,
        additionalKeys: [
          'sk-key-2', 'sk-key-3', 'sk-key-4', 'sk-key-5'
        ],
        renewal: {
          endpoint: 'https://api.internal.com/keys',
          method: 'GET',
          headers: { 'Authorization': 'Bearer token' },
          keyPath: 'apiKey',
          timeoutMs: 10000
        }
      }
    }
  ]
});
```

---

## Quick Reference Table

| Setting | Type | Required | Default | Description |
|---------|------|----------|---------|-------------|
| `enabled` | `boolean` | No | `true` | Master on/off switch |
| `usageLimit` | `number` | **Yes** | - | Requests before rotation |
| `additionalKeys` | `string[]` | No | `[]` | Additional API keys |
| `usageWindowMs` | `number` | No | `undefined` | Time window for usage reset |
| `cooldownMs` | `number` | No | `undefined` | Cooldown before key reuse |
| `retryAttempts` | `number` | No | `3` | Renewal retry attempts |
| `retryDelayMs` | `number` | No | `500` | Delay between retries |
| `renewal` | `object` | No | `undefined` | Key renewal configuration |

---

## Related Documentation

- [Complete Key Rotation Guide](./KEY_ROTATION.md) - Full feature guide with use cases
- [Main Documentation](../README.md) - Core orchestrator documentation
- [Adapter Developer Guide](./KEY_ROTATION.md#adapter-developer-guide) - For custom adapter implementation

---

**Need help?** Check the [troubleshooting guide](./KEY_ROTATION.md#troubleshooting) or open an issue on GitHub.

