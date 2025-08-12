import { AIOrchestrator } from '../src/index';
import { OrchestratorConfig } from '../src/types';

// Mock all adapters
jest.mock('../src/adapters/openai');
jest.mock('../src/adapters/google');
jest.mock('../src/adapters/custom');

// We need to get the actual classes to access their prototypes for mocking
import { CustomAdapter } from '../src/adapters/custom';
import { GoogleAdapter } from '../src/adapters/google';
import { OpenAIAdapter } from '../src/adapters/openai';

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
  
    // Mock the generate method on the prototype of each adapter class
    const mockCustomGenerate = CustomAdapter.prototype.generate as jest.Mock;
    const mockGoogleGenerate = GoogleAdapter.prototype.generate as jest.Mock;
    const mockOpenAIGenerate = OpenAIAdapter.prototype.generate as jest.Mock;
  
    beforeEach(() => {
      // Clear all mocks before each test
      mockCustomGenerate.mockClear();
      mockGoogleGenerate.mockClear();
      mockOpenAIGenerate.mockClear();
      orchestrator = new AIOrchestrator(mockConfig);
    });
  
    it('should select the cheapest provider by default (cost strategy)', async () => {
      mockCustomGenerate.mockResolvedValue({ status: 'completed', data: 'response' });
      await orchestrator.generate({ type: 'text', prompt: 'test' });
      // Expects the first call to be to the 'custom' adapter's model
      expect(mockCustomGenerate).toHaveBeenCalledWith(expect.any(Object), 'local-llama');
    });
  
    it('should select the fastest provider (latency strategy)', async () => {
      mockGoogleGenerate.mockResolvedValue({ status: 'completed', data: 'response' });
      await orchestrator.generate({ type: 'text', prompt: 'test', strategy: 'latency' });
      // Expects the first call to be to the 'google' adapter's model
      expect(mockGoogleGenerate).toHaveBeenCalledWith(expect.any(Object), 'gemini-flash');
    });
  
    it('should select the highest quality provider (quality strategy)', async () => {
      mockOpenAIGenerate.mockResolvedValue({ status: 'completed', data: 'response' });
      await orchestrator.generate({ type: 'text', prompt: 'test', strategy: 'quality' });
      expect(mockOpenAIGenerate).toHaveBeenCalledWith(expect.any(Object), 'gpt-4o');
    });
  
    it('should fall back to the next provider on failure', async () => {
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
      mockCustomGenerate.mockResolvedValue({ status: 'failed', error: 'generic error' });
      mockGoogleGenerate.mockResolvedValue({ status: 'failed', error: 'generic error' });
      mockOpenAIGenerate.mockResolvedValue({ status: 'failed', error: 'generic error' });
      
      const result = await orchestrator.generate({ type: 'text', prompt: 'test' });
      
      expect(result.status).toBe('failed');
      expect(result.error).toContain('All configured providers failed');
      // It should have tried all 3 text providers
      expect(mockCustomGenerate).toHaveBeenCalledTimes(1);
      expect(mockGoogleGenerate).toHaveBeenCalledTimes(1);
      expect(mockOpenAIGenerate).toHaveBeenCalledTimes(1);
    });
});