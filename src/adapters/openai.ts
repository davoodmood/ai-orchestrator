import OpenAI from 'openai';
import { GenerateRequest, GenerateResult, IProviderAdapter, JobStatusResult } from '../types';

// In-memory simulation of a job store for OpenAI's async operations like Sora
const openAIJobStore = new Map<string, { status: 'pending' | 'completed', attempts: number }>();

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
        case 'video':
          // Video generation with Sora is asynchronous.
          const providerJobId = `openai-sora-${Date.now()}`;
          openAIJobStore.set(providerJobId, { status: 'pending', attempts: 0 });
          return { 
            status: 'pending', 
            orchestratorJobId: providerJobId, 
            provider: 'openai', 
            model: modelId 
          };
        default:
          return {
            status: 'failed',
            provider: 'openai',
            model: modelId,
            error: `Unsupported generation type '${request.type}' for OpenAI.`,
          };
      }
    } catch (error: any) {
      return {
        status: 'failed',
        provider: 'openai',
        model: modelId,
        error: error.message || 'An unknown error occurred with the OpenAI API.',
      };
    }
  }

  async checkJobStatus(providerJobId: string): Promise<JobStatusResult> {
    const job = openAIJobStore.get(providerJobId);
    if (!job) {
      return { status: 'failed', error: 'Job not found on OpenAI provider.' };
    }

    // SIMULATION: Let the job complete after 3 polling attempts for video.
    job.attempts++;
    if (job.attempts < 3) {
      return { status: 'pending' };
    } else {
      openAIJobStore.delete(providerJobId); // Clean up the completed job
      return { status: 'completed', data: 'http://path.to/simulated_sora_video.mp4' };
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
      status: 'completed',
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
      quality: 'hd',
    });

    // if (!response || response && !Array.isArray(response.data)) {
    //     throw new Error('No Response was returned from OpenAI image generation.');
    // }

    let imageUrl;

    if (response && response.data && Array.isArray(response.data)) {
        imageUrl = response.data[0]?.url;
    }
    
    if (!imageUrl) {
        throw new Error('No image URL returned from OpenAI image generation.');
    }

    return {
      status: 'completed',
      provider: 'openai',
      model: modelId,
      data: imageUrl,
    };
  }
}