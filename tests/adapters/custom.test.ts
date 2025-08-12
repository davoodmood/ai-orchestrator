import { CustomAdapter } from '../../src/adapters/custom';
import { GenerateRequest } from '../../src/types';

// Mock global fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

describe('CustomAdapter', () => {
  const baseUrl = 'http://localhost:8080';
  let adapter: CustomAdapter;

  beforeEach(() => {
    mockFetch.mockClear();
    adapter = new CustomAdapter(baseUrl);
  });

  it('should fail if health check fails', async () => {
    mockFetch.mockResolvedValue({ ok: false }); // Health check fails

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'my-model');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('unhealthy');
    expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/health`);
  });

  it('should generate content if health check passes', async () => {
    // First call for health check, second for generation
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'completed', data: 'Custom response' }),
      });

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'my-model');

    expect(result.status).toBe('completed');
    expect(result.data).toBe('Custom response');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/generate`, expect.any(Object));
  });

  it('should start an async job', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'pending', jobId: 'custom-123' }),
      });

    const request: GenerateRequest = { type: 'video', prompt: 'A video' };
    const result = await adapter.generate(request, 'my-video-model');

    expect(result.status).toBe('pending');
    expect(result.orchestratorJobId).toBe('custom-123');
  });

  it('should poll for a job status', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'completed', data: 'Final video URL' }),
    });

    const result = await adapter.checkJobStatus('custom-123');
    expect(result.status).toBe('completed');
    expect(result.data).toBe('Final video URL');
    expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/job/custom-123`);
  });
});
