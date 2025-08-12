# AI Orchestrator

[![npm version](https://badge.fury.io/js/ai-orchestrator.svg)](https://badge.fury.io/js/ai-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A flexible, multi-provider AI orchestrator for Node.js that dynamically routes requests to different models (OpenAI, Google, Anthropic, etc.) based on cost, latency, quality, or other custom strategies.

This module allows you to define a pool of AI providers and models in a simple configuration and let the orchestrator handle the complexity of choosing the best one for the job, with automatic fallbacks and resilient error handling.

## Key Features

-   **Unified API**: A single, simple `generate()` method to access any supported AI model.
-   **Multi-Provider Support**: Out-of-the-box support for major providers, easily extensible for others.
-   **Asynchronous Job Polling**: Built-in support for long-running tasks like image generation via a getJobResult() method.
-   **Dynamic Routing Strategies**:
    -   `cost`: (Default) Prioritizes the cheapest model.
    -   `latency`: Prioritizes the fastest model.
    -   `quality`: Prioritizes the highest-quality model.
-   **Resilient Fallbacks**: Automatically retries with the next-best provider if a request fails.

-   **Custom Provider Support**: Easily integrate with your own local or self-hosted models, complete with a cached health-checking mechanism.
-   **Extensible & Configurable**: Define your own providers, models, and API keys without touching the source code.
-   **Bring Your Own Logger**: Integrates with your application's existing logger (e.g., Pino, Winston).

---

## Installation

```bash
npm install ai-orchestrator
```

## Quick Start

1. **Set your API keys** in your environment variables:
```bash
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="..."
export ANTHROPIC_API_KEY="..."
```

2. **Import and initialize** the orchestrator with your desired provider configuration. 
```typescript
import { AIOrchestrator } from 'ai-orchestrator';

// Define your pool of available models
const config = {
  providers: [
    {
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      models: [
        { id: 'gpt-4o-mini', type: 'text', cost: 0.15, quality: 'high' },
        { id: 'dall-e-3', type: 'image', cost: 0.04, quality: 'high' },
        { id: 'sora', type: 'video', cost: 1.0, quality: 'high' } // Example
      ]
    },
    {
      name: 'google',
      apiKey: process.env.GOOGLE_API_KEY || '',
      models: [
        { id: 'gemini-1.5-flash-latest', type: 'text', cost: 0.00, quality: 'medium' }
      ]
    },
    {
      name: 'custom',
      apiKey: '', // Not used by adapter, but can be used by your server
      baseUrl: 'http://localhost:8080',
      models: [
        { id: 'my-local-model', type: 'text', cost: 0.0, quality: 'low' }
      ]
    }
  ]
};

// Create an instance of the orchestrator
const orchestrator = new AIOrchestrator(config);

// Generate content!
async function main() {
  // The orchestrator will automatically pick the cheapest text model (custom)
  const response = await orchestrator.generate({
    type: 'text',
    prompt: 'Write a short poem about TypeScript.'
  });

  if (response.status === 'completed') {
    console.log(`Response from ${response.provider} (${response.model}):`);
    console.log(response.data);
  } else {
    console.error(`Generation failed: ${response.error}`);
  }
}

main();
```

## Advanced Usage
### Routing Strategies

You can specify a routing strategy in the `generate` call.
```typescript
// Prioritize the fastest response time
const fastResponse = await orchestrator.generate({
  type: 'text',
  prompt: 'What is the capital of France?',
  strategy: 'latency'
});

// Prioritize the highest quality model, regardless of cost
const highQualityResponse = await orchestrator.generate({
  type: 'text',
  prompt: 'Explain the theory of relativity in simple terms.',
  strategy: 'quality'
});
```

### Handling Asynchronous Jobs (Video/Audio)
For long-running tasks, the `generate` method will return a `pending` status with a job ID. You can then use `getJobResult` to poll for the final result.

```typescript
// Helper function to poll for a result
async function pollUntilComplete(jobId: string, maxAttempts = 10, delay = 5000) {
    for (let i = 0; i < maxAttempts; i++) {
        console.log(`Polling attempt ${i + 1} for job ${jobId}...`);
        const result = await orchestrator.getJobResult(jobId);

        if (result.status === 'completed') {
            console.log('Job completed!');
            return result.data;
        }
        if (result.status === 'failed') {
            throw new Error(`Job failed: ${result.error}`);
        }
        // If still pending, wait for the next attempt
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('Job timed out after maximum polling attempts.');
}

// --- Start an async video generation job ---
const videoResponse = await orchestrator.generate({
  type: 'video',
  prompt: 'A cat playing a grand piano on a beach at sunset'
});

if (videoResponse.status === 'pending' && videoResponse.orchestratorJobId) {
  console.log(`Video generation started. Job ID: ${videoResponse.orchestratorJobId}`);
  try {
      const finalVideoUrl = await pollUntilComplete(videoResponse.orchestratorJobId);
      if (finalVideoUrl) {
          console.log('Final video URL:', finalVideoUrl);
      }
  } catch (error: any) {
      console.error(error.message);
  }
}
```

### Requesting a Specific Quality
Filter the pool of models to a specific quality tier before applying the routing strategy.

```typescript
const highQualityImage = await orchestrator.generate({
  type: 'image',
  prompt: 'A photorealistic image of an astronaut riding a horse on the moon',
  quality: 'high' // Will only consider models marked as 'high' quality
});
```
-----
## Contributing
Contributions are welcome! Please feel free to submit a pull request or open an issue.

## License
This project is licensed under the MIT License.