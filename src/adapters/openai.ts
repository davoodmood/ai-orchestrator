import OpenAI from 'openai';
import { GenerateRequest, GenerateResult, IProviderAdapter, JobStatusResult, CountTokensRequest, CountTokensResponse, EmbedContentRequest, EmbedContentResponse } from '../types';
// import { encoding_for_model, TiktokenModel } from 'tiktoken';

// In-memory simulation of a job store for OpenAI's async operations like Sora
const openAIJobStore = new Map<string, { status: 'pending' | 'completed', attempts: number }>();

export class OpenAIAdapter implements IProviderAdapter {
  private client: OpenAI;
  private chatSessions: Map<string, OpenAI.Chat.Completions.ChatCompletionMessageParam[]> = new Map();
  private activeSoraJobs: Map<string, { status: 'pending' | 'completed', attempts: number }> = new Map();

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

  /**
     * Counts tokens locally using the tiktoken library to avoid a network call.
     * This is much more efficient for token counting.
     * @param request The request containing the text and model ID.
     * @returns The total number of tokens.
     */
  async countTokens(request: CountTokensRequest): Promise<CountTokensResponse> {
    try {
      console.log("not supported yet.")
        // Throws an error if the model is not supported by tiktoken
        // const encoding = encoding_for_model(request.model as TiktokenModel);
        // const tokens = encoding.encode(request.text);
        // const totalTokens = tokens.length;
        // encoding.free(); // Important: release the memory used by the encoder
        return { success: false, totalTokens: 0 };
    } catch (error: any) {
        return { success: false, error: `Could not count tokens for model ${request.model}. It may not be supported by the tiktoken library. Original error: ${error.message}` };
    }
  }

  /**
     * NEW: Generates embeddings for an array of texts using OpenAI's API.
     */
  async embedContent(request: EmbedContentRequest, modelId: string): Promise<EmbedContentResponse> {
    try {
        const response = await this.client.embeddings.create({
            model: modelId,
            input: request.texts,
        });

        // Sort embeddings to match the order of the input texts
        const sortedEmbeddings = response.data.sort((a, b) => a.index - b.index);
        const embeddings = sortedEmbeddings.map(item => item.embedding);

        return { success: true, embeddings };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

  public async endChatSession(sessionId: string): Promise<void> {
      // ... existing implementation ...
  }
}