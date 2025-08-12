import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { GenerateRequest, GenerateResult, IProviderAdapter } from '../types';

export class GoogleAdapter implements IProviderAdapter {
  private client: GoogleGenerativeAI;
  // Basic safety settings to avoid blocking common prompts.
  private safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  ];

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Google API key is required.');
    }
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
    try {
      switch (request.type) {
        case 'text':
          return await this.generateText(request.prompt, modelId);
        case 'audio':
          // NOTE: As of late 2024, Google's TTS is often part of the Gemini API itself or a separate service.
          // This is a placeholder for a potential future direct TTS model.
          return this.unsupported(request.type, modelId);
        case 'video':
          // NOTE: Video generation (Veo) is asynchronous and may require polling.
          // This is a simplified placeholder. A real implementation would need a robust polling mechanism.
          return this.unsupported(request.type, modelId);
        default:
          return this.unsupported(request.type, modelId);
      }
    } catch (error: any) {
      return {
        success: false,
        provider: 'google',
        model: modelId,
        data: '',
        error: error.message || 'An unknown error occurred with the Google API.',
      };
    }
  }
  
  private async generateText(prompt: string, modelId: string): Promise<GenerateResult> {
    const model = this.client.getGenerativeModel({ model: modelId, safetySettings: this.safetySettings });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    return {
      success: true,
      provider: 'google',
      model: modelId,
      data: text,
    };
  }
  
  private unsupported(type: string, modelId: string): GenerateResult {
      return {
          success: false,
          provider: 'google',
          model: modelId,
          data: '',
          error: `Generation type '${type}' is not currently supported by the Google adapter.`,
      };
  }
}