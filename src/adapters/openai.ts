import OpenAI from 'openai';
import { GenerateRequest, GenerateResult, IProviderAdapter } from '../types';

export class OpenAIAdapter implements IProviderAdapter {
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required.');
    }
    this.client = new OpenAI({ apiKey });
  }

  async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
    try {
      switch (request.type) {
        case 'text':
          return await this.generateText(request.prompt, modelId);
        case 'image':
          return await this.generateImage(request.prompt, modelId);
        default:
          return {
            success: false,
            provider: 'openai',
            model: modelId,
            data: '',
            error: `Unsupported generation type '${request.type}' for OpenAI.`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        provider: 'openai',
        model: modelId,
        data: '',
        error: error.message || 'An unknown error occurred with the OpenAI API.',
      };
    }
  }

  private async generateText(prompt: string, modelId: string): Promise<GenerateResult> {
    const response = await this.client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content returned from OpenAI text generation.');
    }

    return {
      success: true,
      provider: 'openai',
      model: modelId,
      data: content,
    };
  }

  private async generateImage(prompt: string, modelId: string): Promise<GenerateResult> {
    const response = await this.client.images.generate({
      model: modelId,
      prompt: prompt,
      n: 1,
      size: '1024x1024',
    });

    const imageUrl = response.data[0]?.url;
    if (!imageUrl) {
      throw new Error('No image URL returned from OpenAI image generation.');
    }

    return {
      success: true,
      provider: 'openai',
      model: modelId,
      data: imageUrl,
    };
  }
}