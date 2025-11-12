import { KeyRotationManager } from '../../src/utils/keyRotationManager';

describe('KeyRotationManager', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  it('rotates to the next available key when usage limit is reached', async () => {
    const manager = new KeyRotationManager({
      initialKey: 'key-1',
      config: {
        usageLimit: 2,
        additionalKeys: ['key-2'],
      },
    });

    expect(await manager.getActiveKey()).toBe('key-1');

    await manager.markSuccess();
    await manager.markSuccess(); // triggers rotation

    expect(await manager.getActiveKey()).toBe('key-2');
  });

  it('fetches a new key from the renewal endpoint when keys are exhausted', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { apiKey: 'key-2' } }),
    });
    (global as any).fetch = mockFetch;

    const manager = new KeyRotationManager({
      initialKey: 'key-1',
      config: {
        usageLimit: 1,
        renewal: {
          endpoint: 'https://internal/key',
          keyPath: 'data.apiKey',
        },
      },
    });

    await manager.markSuccess(); // triggers renewal

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await manager.getActiveKey()).toBe('key-2');
  });

  it('does not spam the renewal endpoint when multiple rate-limit events occur concurrently', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ apiKey: 'key-rotated' }),
    });
    (global as any).fetch = mockFetch;

    const manager = new KeyRotationManager({
      initialKey: 'key-1',
      config: {
        usageLimit: 10,
        renewal: {
          endpoint: 'https://internal/key',
          keyPath: 'apiKey',
        },
      },
    });

    await Promise.all([
      manager.markRateLimit(),
      manager.markRateLimit(),
      manager.markRateLimit(),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await manager.getActiveKey()).toBe('key-rotated');
  });

  it('falls back to the current key when renewal fails after retries', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    (global as any).fetch = mockFetch;

    const manager = new KeyRotationManager({
      initialKey: 'key-1',
      config: {
        usageLimit: 1,
        retryAttempts: 2,
        renewal: {
          endpoint: 'https://internal/key',
        },
      },
    });

    await manager.markSuccess(); // triggers renewal attempts

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(await manager.getActiveKey()).toBe('key-1');
  });
});
