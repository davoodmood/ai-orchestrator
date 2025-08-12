import { GoogleAdapter } from '../../src/adapters/google';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GenerateRequest } from '../../src/types';

jest.mock('@google/generative-ai');

const MockedGoogleGenerativeAI = GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>;
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
}));

describe('GoogleAdapter', () => {
  let adapter: GoogleAdapter;

  beforeEach(() => {
    MockedGoogleGenerativeAI.mockClear();
    mockGenerateContent.mockClear();
    mockGetGenerativeModel.mockClear();

    MockedGoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    } as any));

    adapter = new GoogleAdapter('fake-api-key');
  });

  it('should generate text successfully', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => 'Hello from Gemini',
      },
    });

    const request: GenerateRequest = { type: 'text', prompt: 'Hello' };
    const result = await adapter.generate(request, 'gemini-1.5-flash-latest');

    expect(result.status).toBe('completed');
    expect(result.provider).toBe('google');
    expect(result.data).toBe('Hello from Gemini');
    expect(mockGetGenerativeModel).toHaveBeenCalledWith({
      model: 'gemini-1.5-flash-latest',
      safetySettings: expect.any(Array),
    });
  });

  it('should start a video generation job', async () => {
    const request: GenerateRequest = { type: 'video', prompt: 'A dog on a skateboard' };
    const result = await adapter.generate(request, 'veo-3-preview');

    expect(result.status).toBe('pending');
    expect(result.provider).toBe('google');
    expect(result.orchestratorJobId).toBeDefined();
  });

  it('should return completed for a video job after polling', async () => {
    const request: GenerateRequest = { type: 'video', prompt: 'A dog on a skateboard' };
    const { orchestratorJobId } = await adapter.generate(request, 'veo-3-preview');

    await adapter.checkJobStatus(orchestratorJobId!); // Attempt 1
    const finalResult = await adapter.checkJobStatus(orchestratorJobId!); // Attempt 2

    expect(finalResult.status).toBe('completed');
  });

  it('should return an error for unsupported types', async () => {
    const request: GenerateRequest = { type: 'image', prompt: 'An image' };
    const result = await adapter.generate(request, 'gemini-1.5-flash-latest');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Unsupported type');
  });
});