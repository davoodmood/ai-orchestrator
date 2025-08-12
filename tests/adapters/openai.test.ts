import { OpenAIAdapter } from '../../src/adapters/openai';
import OpenAI from 'openai';
import { GenerateRequest } from '../../src/types';

// Mock the entire OpenAI module
jest.mock('openai');

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  const mockCreate = jest.fn();
  const mockImagesGenerate = jest.fn();

  beforeEach(() => {
    // Reset mocks before each test
    MockedOpenAI.mockClear();
    mockCreate.mockClear();
    mockImagesGenerate.mockClear();

    // Setup the mock implementation
    MockedOpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
      images: {
        generate: mockImagesGenerate,
      },
    } as any));

    adapter = new OpenAIAdapter('fake-api-key');
  });

  it('should generate text successfully', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Hello from OpenAI' } }],
    });

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'gpt-4o-mini');

    expect(result.status).toBe('completed');
    expect(result.provider).toBe('openai');
    expect(result.data).toBe('Hello from OpenAI');
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hello' }],
    });
  });

  it('should generate an image successfully', async () => {
    const imageUrl = 'http://example.com/image.png';
    mockImagesGenerate.mockResolvedValue({
      data: [{ url: imageUrl }],
    });

    const request: GenerateRequest = { type: 'image', prompt: 'A cat' };
    const result = await adapter.generate(request, 'dall-e-3');

    expect(result.status).toBe('completed');
    expect(result.data).toBe(imageUrl);
    expect(mockImagesGenerate).toHaveBeenCalledWith({
      model: 'dall-e-3',
      prompt: 'A cat',
      n: 1,
      size: '1024x1024',
      quality: 'hd',
    });
  });

  it('should start a video generation job', async () => {
    const request: GenerateRequest = { type: 'video', prompt: 'A robot dancing' };
    const result = await adapter.generate(request, 'sora-1');

    expect(result.status).toBe('pending');
    expect(result.provider).toBe('openai');
    expect(result.orchestratorJobId).toBeDefined();
  });

  it('should check a pending video job status', async () => {
    const request: GenerateRequest = { type: 'video', prompt: 'A robot dancing' };
    const { orchestratorJobId } = await adapter.generate(request, 'sora-1');

    const statusResult = await adapter.checkJobStatus(orchestratorJobId!);
    expect(statusResult.status).toBe('pending');
  });

  it('should return completed after several status checks', async () => {
    const request: GenerateRequest = { type: 'video', prompt: 'A robot dancing' };
    const { orchestratorJobId } = await adapter.generate(request, 'sora-1');

    await adapter.checkJobStatus(orchestratorJobId!); // Attempt 1
    await adapter.checkJobStatus(orchestratorJobId!); // Attempt 2
    const finalResult = await adapter.checkJobStatus(orchestratorJobId!); // Attempt 3

    expect(finalResult.status).toBe('completed');
    expect(finalResult.data).toBeDefined();
  });

  it('should handle API errors gracefully', async () => {
    mockCreate.mockRejectedValue(new Error('API Key invalid'));

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'gpt-4o-mini');

    expect(result.status).toBe('failed');
    expect(result.error).toBe('API Key invalid');
  });
});