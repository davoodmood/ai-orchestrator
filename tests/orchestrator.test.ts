import { AIOrchestrator } from '../src/index';
import { OrchestratorConfig } from '../src/types';

// Mock all adapters
jest.mock('../../src/adapters/openai');
jest.mock('../../src/adapters/google');
jest.mock('../../src/adapters/custom');

const mockConfig: OrchestratorConfig = {
  providers: [
    {
      name: 'openai',
      apiKey: 'fake-key',
      models: [{ id: 'gpt-4o', type: 'text', cost: 1.0, quality: 'high', avg_latency_ms: 500 }],
    },
    {
      name: 'google',
      apiKey: 'fake-key',
      models: [{ id: 'gemini-flash', type: 'text', cost: 0.1, quality: 'medium', avg_latency_ms: 200 }],
    },
    {
      name: 'custom',
      apiKey: '',
      baseUrl: 'http://localhost:8080',
      models: [{ id: 'local-llama', type: 'text', cost: 0.0, quality: 'low', avg_latency_ms: 800 }],
    },
  ],
};

describe('AIOrchestrator', () => {
  let orchestrator: AIOrchestrator;

  // Get the mock generate function from the prototype of one of the mocked adapters
  const mockGenerate = require('../../src/adapters/openai').OpenAIAdapter.prototype.generate;

  beforeEach(() => {
    mockGenerate.mockClear();
    orchestrator = new AIOrchestrator(mockConfig);
  });

  it('should select the cheapest provider by default (cost strategy)', async () => {
    mockGenerate.mockResolvedValue({ status: 'completed', data: 'response' });
    await orchestrator.generate({ type: 'text', prompt: 'test' });
    // Expects the first call to be to the 'custom' adapter's model
    expect(mockGenerate).toHaveBeenCalledWith(expect.any(Object), 'local-llama');
  });

  it('should select the fastest provider (latency strategy)', async () => {
    mockGenerate.mockResolvedValue({ status: 'completed', data: 'response' });
    await orchestrator.generate({ type: 'text', prompt: 'test', strategy: 'latency' });
    // Expects the first call to be to the 'google' adapter's model
    expect(mockGenerate).toHaveBeenCalledWith(expect.any(Object), 'gemini-flash');
  });

  it('should select the highest quality provider (quality strategy)', async () => {
    mockGenerate.mockResolvedValue({ status: 'completed', data: 'response' });
    // We need to require the specific mock to check its call
    const mockOpenAIGenerate = require('../../src/adapters/openai').OpenAIAdapter.prototype.generate;
    await orchestrator.generate({ type: 'text', prompt: 'test', strategy: 'quality' });
    expect(mockOpenAIGenerate).toHaveBeenCalledWith(expect.any(Object), 'gpt-4o');
  });

  it('should fall back to the next provider on failure', async () => {
    const mockCustomGenerate = require('../../src/adapters/custom').CustomAdapter.prototype.generate;
    const mockGoogleGenerate = require('../../src/adapters/google').GoogleAdapter.prototype.generate;

    // First (cheapest) provider fails
    mockCustomGenerate.mockResolvedValue({ status: 'failed', error: 'server down' });
    // Second (next cheapest) provider succeeds
    mockGoogleGenerate.mockResolvedValue({ status: 'completed', data: 'google response', provider: 'google', model: 'gemini-flash' });

    const result = await orchestrator.generate({ type: 'text', prompt: 'test' });
    
    expect(result.status).toBe('completed');
    expect(result.provider).toBe('google');
    expect(mockCustomGenerate).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenerate).toHaveBeenCalledTimes(1);
  });
  
  it('should return an error if all providers fail', async () => {
    mockGenerate.mockResolvedValue({ status: 'failed', error: 'generic error' });
    const result = await orchestrator.generate({ type: 'text', prompt: 'test' });
    
    expect(result.status).toBe('failed');
    expect(result.error).toContain('All configured providers failed');
    // It should have tried all 3 text providers
    expect(mockGenerate).toHaveBeenCalledTimes(3);
  });
});