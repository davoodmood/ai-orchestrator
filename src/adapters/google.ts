import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, GenerationConfig, ChatSession, GenerateContentStreamResult, EmbedContentRequest as GoogleEmbedContentRequest } from '@google/generative-ai';
import { CountTokensRequest, CountTokensResponse, EmbedContentRequest, EmbedContentResponse, GenerateRequest, GenerateResult, GenerateStreamRequest, IProviderAdapter, JobStatusResult, StreamGenerateResult } from '../types';

// In-memory simulation of a job store for Google's async operations
const googleJobStore = new Map<string, { status: 'pending' | 'completed', attempts: number }>();

export class GoogleAdapter implements IProviderAdapter {
  private client: GoogleGenerativeAI;
  // NEW: Manages active chat sessions based on user's sessionId
  private chatSessions: Map<string, ChatSession> = new Map();

  private safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  ];

  constructor(apiKey: string) { /* ... constructor ... */ 
    if (!apiKey) { throw new Error('Google API key is required.'); }
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
    try {
      switch (request.type) {
        case 'text':
          const generationConfig: GenerationConfig = {
            ...(request.params?.temperature && { temperature: request.params.temperature }),
            ...(request.params?.maxTokens && { maxOutputTokens: request.params.maxTokens }),
            ...(request.params?.topP && { topP: request.params.topP }),
          };
          
          // --- Dynamically build model parameters ---
          const modelParams: any = {
              model: modelId,
              safetySettings: this.safetySettings,
          };

          // Only add systemInstruction if it is a non-empty string.
          // This prevents passing `undefined` or `""` which caused the tests to fail.
          if (request.systemPrompt) {
              modelParams.systemInstruction = request.systemPrompt;
          }

          const model = this.client.getGenerativeModel(modelParams);  
        
          if (request.caching?.sessionId) {
            const sessionId = request.caching.sessionId;
            let chat = this.chatSessions.get(sessionId);

            if (!chat) {
                // Start a new chat session if it's the first time we see this ID
                chat = model.startChat({
                    generationConfig,
                    // History can be pre-filled if needed, but we start fresh here
                });
                this.chatSessions.set(sessionId, chat);
              }

              const result = await chat.sendMessage(request.prompt);
              const response = result.response;
              const tokenUsage = response.usageMetadata;

              return { 
                status: 'completed', 
                provider: 'google', 
                model: modelId, 
                data: response.text(),
                tokenUsage: {
                  inputTokens: tokenUsage?.promptTokenCount ?? 0,
                  outputTokens: tokenUsage?.candidatesTokenCount ?? 0,
                  totalTokens: tokenUsage?.totalTokenCount ?? 0,
                }
              };
          } else {
            // For single, stateless requests, use generateContent
            const result = await model.generateContent({
              contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
              generationConfig,
            });

            const response = result.response;
            const tokenUsage = response.usageMetadata;

            return { 
              status: 'completed', 
              provider: 'google', 
              model: modelId, 
              data: response.text(),
              tokenUsage: {
                  inputTokens: tokenUsage?.promptTokenCount ?? 0,
                  outputTokens: tokenUsage?.candidatesTokenCount ?? 0,
                  totalTokens: tokenUsage?.totalTokenCount ?? 0,
              }
            };
          }
        case 'video':
          // Video is asynchronous, so we start a job and return a job ID.
          const providerJobId = `google-vid-${Date.now()}`;
          googleJobStore.set(providerJobId, { status: 'pending', attempts: 0 });
          return { status: 'pending', orchestratorJobId: providerJobId, provider: 'google', model: modelId };
        default:
          return { status: 'failed', provider: 'google', model: modelId, error: `Unsupported type '${request.type}'.` };
      }
    } catch (error: any) {
      return { status: 'failed', provider: 'google', model: modelId, error: error.message };
    }
  }

  /**
     * Generates content as a stream using Google's SDK.
     * @param request The generation request.
     * @param modelId The model ID to use.
     * @returns An async generator yielding stream chunks.
     */
  async * generateStream(request: GenerateStreamRequest, modelId: string): AsyncGenerator<StreamGenerateResult> {
    const generationConfig: GenerationConfig = {
        ...(request.params?.temperature && { temperature: request.params.temperature }),
        ...(request.params?.maxTokens && { maxOutputTokens: request.params.maxTokens }),
        ...(request.params?.topP && { topP: request.params.topP }),
    };

    // --- Dynamically build model parameters ---
    const modelParams: any = {
      model: modelId,
      safetySettings: this.safetySettings,
    };

    // Only add systemInstruction if it is a non-empty string.
    // This prevents passing `undefined` or `""` which caused the tests to fail.
    if (request.systemPrompt) {
      modelParams.systemInstruction = request.systemPrompt;
    }
    
    const model = this.client.getGenerativeModel(modelParams);

    try {
        const streamResult: GenerateContentStreamResult = await model.generateContentStream(request.prompt);
        
        // Yield each chunk as it arrives
        for await (const chunk of streamResult.stream) {
            yield {
                status: 'streaming',
                provider: 'google',
                model: modelId,
                data: chunk.text(),
            };
        }

        // After the stream is finished, get the aggregated response for token usage
        const finalResponse = await streamResult.response;
        const tokenUsage = finalResponse.usageMetadata;

        yield {
            status: 'completed',
            provider: 'google',
            model: modelId,
            tokenUsage: {
                inputTokens: tokenUsage?.promptTokenCount ?? 0,
                outputTokens: tokenUsage?.candidatesTokenCount ?? 0,
                totalTokens: tokenUsage?.totalTokenCount ?? 0,
            }
        };

    } catch (error: any) {
        yield { status: 'error', provider: 'google', model: modelId, error: error.message };
    }
  }

  async checkJobStatus(providerJobId: string): Promise<JobStatusResult> {
    const job = googleJobStore.get(providerJobId);
    if (!job) {
      return { status: 'failed', error: 'Job not found on Google provider.' };
    }

    // SIMULATION: Let the job complete after 2 polling attempts.
    job.attempts++;
    if (job.attempts < 2) {
      return { status: 'pending' };
    } else {
      googleJobStore.delete(providerJobId); // Clean up the completed job
      // TODO: update the data path.to with a real path
      return { status: 'completed', data: 'http://path.to/simulated_video.mp4' };
    }
  }

  /**
     * Counts tokens using the Google Generative AI SDK.
     * @param request The request containing the text and model ID.
     * @returns The total number of tokens.
  */
  async countTokens(request: CountTokensRequest): Promise<CountTokensResponse> {
    try {
      const model = this.client.getGenerativeModel({ model: request.model });
      const { totalTokens } = await model.countTokens(request.text);
      return { success: true, totalTokens };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
     * Implements the session cleanup logic for the Google adapter.
     * If a chat session with the given ID exists in memory, it is deleted.
     * @param sessionId The unique ID of the session to remove.
  */
  public async endChatSession(sessionId: string): Promise<void> {
    if (this.chatSessions.has(sessionId)) {
        this.chatSessions.delete(sessionId);
        // In a real application, you might log this for debugging.
        // console.log(`Cleaned up Google chat session: ${sessionId}`);
    }
  }

  /**
     * Generates embeddings for an array of texts.
     * It intelligently uses batching for multiple texts to improve efficiency.
     */
  async embedContent(request: EmbedContentRequest, modelId: string): Promise<EmbedContentResponse> {
    try {
        const model = this.client.getGenerativeModel({ model: modelId });

        if (request.texts.length === 1) {
            // Use single, more direct method for one piece of text
            const result = await model.embedContent(request.texts[0]);
            return { success: true, embeddings: [result.embedding.values] };
        } else {
            // Use the batch method for multiple texts
            const requests: GoogleEmbedContentRequest[] = request.texts.map(text => ({
                content: { role: 'user', parts: [{ text }] }
            }));
            const result = await model.batchEmbedContents({ requests });
            const embeddings = result.embeddings.map(e => e.values);
            return { success: true, embeddings };
        }
    } catch (error: any) {
        return { success: false, error: error.message };
    }
  }
}
