import { OpenAIAdapter } from '../../src/adapters/openai';
import OpenAI from 'openai';
import { GenerateRequest } from '../../src/types';

// Mock the entire OpenAI module
jest.mock('openai');

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  const mockResponsesCreate = jest.fn();
  const mockImagesGenerate = jest.fn();

  beforeEach(() => {
    // Reset mocks before each test
    MockedOpenAI.mockClear();
    mockResponsesCreate.mockClear();
    mockImagesGenerate.mockClear();

    // Setup the mock implementation
    MockedOpenAI.mockImplementation(() => ({
      responses: {
        create: mockResponsesCreate,
      },
      images: {
        generate: mockImagesGenerate,
      },
    } as any));

    adapter = new OpenAIAdapter('fake-api-key');
  });

  it('should generate text successfully', async () => {
    mockResponsesCreate.mockResolvedValue({
      id: 'resp_123',
      output_text: 'Hello from OpenAI',
      usage: {
        input_tokens: 5,
        output_tokens: 10,
        total_tokens: 15,
      },
    });

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'gpt-4o-mini');

    expect(result.status).toBe('completed');
    expect(result.provider).toBe('openai');
    expect(result.data).toBe('Hello from OpenAI');
    expect(mockResponsesCreate).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      input: 'Hello',
    });
  });

  it('should apply system instructions and reuse session caching', async () => {
    mockResponsesCreate.mockResolvedValueOnce({
      id: 'resp_session_1',
      output_text: 'First turn',
    });

    await adapter.generate(
      {
        type: 'text',
        prompt: 'Hello there',
        systemPrompt: 'Speak like a pirate.',
        caching: { sessionId: 'session-1' },
      },
      'gpt-4o-mini',
    );

  expect(mockResponsesCreate).toHaveBeenNthCalledWith(1, {
    model: 'gpt-4o-mini',
    input: [
      { role: 'system', content: 'Speak like a pirate.' },
      { role: 'user', content: 'Hello there' },
    ],
    instructions: 'Speak like a pirate.',
    store: true,
  });

    mockResponsesCreate.mockResolvedValueOnce({
      id: 'resp_session_2',
      output_text: 'Second turn',
    });

    await adapter.generate(
      {
        type: 'text',
        prompt: 'Ahoy?',
        caching: { sessionId: 'session-1' },
      },
      'gpt-4o-mini',
    );

    expect(mockResponsesCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: 'gpt-4o-mini',
        input: [
          { role: 'system', content: 'Speak like a pirate.' },
          { role: 'user', content: 'Ahoy?' },
        ],
        previous_response_id: 'resp_session_1',
        instructions: 'Speak like a pirate.',
        store: true,
      }),
    );
  });

  it('should include system instructions when no caching is provided', async () => {
    mockResponsesCreate.mockResolvedValue({
      id: 'resp_no_cache',
      output_text: 'Standalone response',
    });

    await adapter.generate(
      {
        type: 'text',
        prompt: 'Explain recursion.',
        systemPrompt: 'Respond in limerick form.',
      },
      'gpt-4o-mini',
    );

    expect(mockResponsesCreate).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      input: [
        { role: 'system', content: 'Respond in limerick form.' },
        { role: 'user', content: 'Explain recursion.' },
      ],
      instructions: 'Respond in limerick form.',
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
    mockResponsesCreate.mockRejectedValue(new Error('API Key invalid'));

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'gpt-4o-mini');

    expect(result.status).toBe('failed');
    expect(result.error).toBe('API Key invalid');
  });
});