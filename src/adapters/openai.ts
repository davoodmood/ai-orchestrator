import OpenAI from 'openai';
import { GenerateRequest, GenerateResult, IProviderAdapter, JobStatusResult, CountTokensRequest, CountTokensResponse, EmbedContentRequest, EmbedContentResponse, KeyRotationConfig, KeyRotationLogger } from '../types';
import { KeyRotationManager } from '../utils/keyRotationManager';
// import { encoding_for_model, TiktokenModel } from 'tiktoken';

// In-memory simulation of a job store for OpenAI's async operations like Sora
const openAIJobStore = new Map<string, { status: 'pending' | 'completed', attempts: number }>();

interface OpenAIAdapterOptions {
  apiKey: string;
  keyRotation?: KeyRotationConfig;
  logger?: KeyRotationLogger;
}

export class OpenAIAdapter implements IProviderAdapter {
  private client: OpenAI;
  private sessionState: Map<string, { previousResponseId?: string; instructions?: string }> = new Map();
  private activeSoraJobs: Map<string, { status: 'pending' | 'completed', attempts: number }> = new Map();
  private readonly logger: KeyRotationLogger;
  private keyRotationManager?: KeyRotationManager;
  private currentApiKey: string;

  constructor(apiKeyOrOptions: string | OpenAIAdapterOptions) {
    let apiKey: string;
    let keyRotation: KeyRotationConfig | undefined;
    let logger: KeyRotationLogger | undefined;

    if (typeof apiKeyOrOptions === 'string') {
      apiKey = apiKeyOrOptions;
    } else {
      apiKey = apiKeyOrOptions.apiKey;
      keyRotation = apiKeyOrOptions.keyRotation;
      logger = apiKeyOrOptions.logger;
    }

    if (!apiKey) {
      throw new Error('OpenAI API key is required.');
    }
    this.currentApiKey = apiKey;
    this.logger = logger ?? console;
    this.client = new OpenAI({ apiKey });

    if (keyRotation && keyRotation.enabled !== false) {
      try {
        this.keyRotationManager = new KeyRotationManager({
          initialKey: apiKey,
          config: keyRotation,
          logger: this.logger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.warn?.('Failed to initialize key rotation for OpenAIAdapter.', { message });
      }
    }
  }

  private async ensureClient(): Promise<void> {
    if (!this.keyRotationManager) {
      return;
    }
    try {
      const activeKey = await this.keyRotationManager.getActiveKey();
      if (activeKey && activeKey !== this.currentApiKey) {
        this.client = new OpenAI({ apiKey: activeKey });
        this.currentApiKey = activeKey;
        this.logger?.info?.('OpenAIAdapter refreshed client with rotated API key.', {
          keySuffix: activeKey.slice(-6),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error?.('Failed to acquire API key from rotation manager.', { message });
    }
  }

  private async recordUsage(result: 'success' | 'rate-limit'): Promise<void> {
    if (!this.keyRotationManager) {
      return;
    }
    try {
      if (result === 'success') {
        await this.keyRotationManager.markSuccess();
      } else {
        await this.keyRotationManager.markRateLimit();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn?.('Failed to update key rotation usage for OpenAIAdapter.', { result, message });
    }
  }

  private isRateLimitError(error: unknown): boolean {
    if (!error) {
      return false;
    }
    if (typeof error === 'object') {
      const status = (error as any).status ?? (error as any).httpStatus;
      if (status === 429) {
        return true;
      }
      const code = (error as any).code;
      if (typeof code === 'string' && /rate[_-]?limit/i.test(code)) {
        return true;
      }
    }
    const message =
      typeof error === 'string'
        ? error
        : typeof error === 'object' && error && 'message' in error
          ? String((error as any).message)
          : '';
    return /\brate limit\b/i.test(message) || /\b429\b/.test(message);
  }

  async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
    try {
      await this.ensureClient();
      switch (request.type) {
        case 'text':
          return await this.generateText(request, modelId);
        case 'image':
          return await this.generateImage(request.prompt, modelId);
        case 'video':
          // Video generation with Sora is asynchronous.
          const providerJobId = `openai-sora-${Date.now()}`;
          openAIJobStore.set(providerJobId, { status: 'pending', attempts: 0 });
          await this.recordUsage('success');
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
      if (this.isRateLimitError(error)) {
        await this.recordUsage('rate-limit');
      }
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

  private async generateText(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
    const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: modelId,
      input: request.prompt,
    };

    if (request.params?.temperature !== undefined) {
      params.temperature = request.params.temperature;
    }

    if (request.params?.topP !== undefined) {
      params.top_p = request.params.topP;
    }

    if (request.params?.maxTokens !== undefined) {
      params.max_output_tokens = request.params.maxTokens;
    }

    const sessionId = request.caching?.sessionId;
    let existingSession: { previousResponseId?: string; instructions?: string } | undefined;
    if (sessionId) {
      existingSession = this.sessionState.get(sessionId);
    }

    const systemInstructions = request.systemPrompt ?? existingSession?.instructions;
    if (systemInstructions) {
      const messages: OpenAI.Responses.EasyInputMessage[] = [
        { role: 'user', content: request.prompt },
      ];

      messages.unshift({ role: 'system', content: systemInstructions });
      params.input = messages;
      params.instructions = systemInstructions;
    } else {
      params.input = request.prompt;
    }

    if (sessionId) {
      if (existingSession?.previousResponseId) {
        params.previous_response_id = existingSession.previousResponseId;
      }
      if (systemInstructions) {
        params.instructions = systemInstructions;
      }
      params.store = true;
    }

    const response = await this.client.responses.create(params);

    const content = response.output_text;
    if (!content) {
      throw new Error('No content returned from OpenAI text generation.');
    }

    if (sessionId) {
      this.sessionState.set(sessionId, {
        previousResponseId: response.id,
        instructions: params.instructions ?? existingSession?.instructions,
      });
    }

    await this.recordUsage('success');

    return {
      status: 'completed',
      provider: 'openai',
      model: modelId,
      data: content,
      tokenUsage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
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

    await this.recordUsage('success');

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
      await this.ensureClient();
      const response = await this.client.embeddings.create({
        model: modelId,
        input: request.texts,
      });

      // Sort embeddings to match the order of the input texts
      const sortedEmbeddings = response.data.sort((a, b) => a.index - b.index);
      const embeddings = sortedEmbeddings.map((item) => item.embedding);

      await this.recordUsage('success');
      return { success: true, embeddings };
    } catch (error: any) {
      if (this.isRateLimitError(error)) {
        await this.recordUsage('rate-limit');
      }
      return { success: false, error: error.message };
    }
  }

  public async endChatSession(sessionId: string): Promise<void> {
    if (this.sessionState.has(sessionId)) {
      this.sessionState.delete(sessionId);
    }
  }
}