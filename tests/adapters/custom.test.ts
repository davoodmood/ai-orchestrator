import { CustomAdapter } from '../../src/adapters/custom';
import { GenerateRequest, ProviderConfig } from '../../src/types';

// Mock global fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

describe('CustomAdapter', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  // --- Health Check Tests ---
  it('should fail if a required health check fails', async () => {
    const config: ProviderConfig = {
      name: 'custom',
      apiKey: 'test-key',
      baseUrl: 'http://localhost:8080',
      healthCheckEndpoint: '/health',
      models: [],
    };
    const adapter = new CustomAdapter(config);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'my-model');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('unhealthy or unreachable');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/health');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should skip health check and succeed if no endpoint is provided', async () => {
    const config: ProviderConfig = {
      name: 'custom',
      apiKey: 'test-key',
      baseUrl: 'http://localhost:8080',
      // No healthCheckEndpoint
      responseExtractor: 'data',
      models: [],
    };
    const adapter = new CustomAdapter(config);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: 'Success without health check' }),
    });

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'my-model');

    expect(result.status).toBe('completed');
    expect(result.data).toBe('Success without health check');
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only the generate call is made
  });

  // --- Generic Feature Tests ---
  it('should use custom authentication headers and scheme from config', async () => {
    const config: ProviderConfig = {
      name: 'one-api',
      apiKey: 'one-api-secret-token',
      baseUrl: 'https://api.one-api.ir',
      authenticationHeader: 'one-api-token',
      authenticationScheme: 'Bearer ', // Note the trailing space
      responseExtractor: 'result[0]',
      models: [],
    };
    const adapter = new CustomAdapter(config);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: ['one-api response'] }),
    });

    await adapter.generate({ type: 'text', prompt: 'test' }, 'gpt-4o');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.one-api.ir',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'one-api-token': 'Bearer one-api-secret-token',
        },
      })
    );
  });

  it('should construct the request body from a template', async () => {
    const config: ProviderConfig = {
      name: 'custom',
      apiKey: '',
      baseUrl: 'http://localhost:8080',
      requestBodyTemplate: '[{ "role": "user", "content": "{{prompt}}", "model": "{{model}}" }]',
      responseExtractor: 'data',
      models: [],
    };
    const adapter = new CustomAdapter(config);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: 'response' }),
    });

    await adapter.generate({ type: 'text', prompt: 'A test prompt' }, 'custom-model-1');

    const expectedBody = JSON.stringify([
      { role: 'user', content: 'A test prompt', model: 'custom-model-1' },
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080',
      expect.objectContaining({
        body: expectedBody,
      })
    );
  });

  it('should extract data from a nested path using responseExtractor', async () => {
    const config: ProviderConfig = {
      name: 'custom',
      apiKey: '',
      baseUrl: 'http://localhost:8080',
      responseExtractor: 'choices[0].message.content',
      models: [],
    };
    const adapter = new CustomAdapter(config);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'This is the nested response' } }],
      }),
    });

    const result = await adapter.generate({ type: 'text', prompt: 'test' }, 'model');
    expect(result.status).toBe('completed');
    expect(result.data).toBe('This is the nested response');
  });
});