import { CountTokensRequest, CountTokensResponse, EmbedContentRequest, EmbedContentResponse, GenerateRequest, GenerateResult, GenerateStreamRequest, IProviderAdapter, JobStatusResult, ProviderConfig, StreamGenerateResult } from '../types';

// Helper function to safely get a nested property from an object using a string path like 'choices[0].text'
function getNestedProperty(obj: any, path: string): any {
  return path.split(/[.[\]]+/).filter(Boolean).reduce((acc, part) => acc && acc[part], obj);
}

interface HealthStatus {
  isHealthy: boolean;
  lastChecked: number;
}

export class CustomAdapter implements IProviderAdapter {
  private config: ProviderConfig;
  private baseUrl: string;
  private healthCheckEndpoint: string;
  private healthStatus: HealthStatus = { isHealthy: false, lastChecked: 0 };
  private readonly healthCacheTTL = 60 * 1000; // Cache health status for 60 seconds

  constructor(providerConfig: ProviderConfig) {
    if (!providerConfig.baseUrl) {
      throw new Error("CustomAdapter requires a 'baseUrl' in its configuration.");
    }
    this.config = providerConfig;
    this.baseUrl = this.config?.baseUrl?.endsWith('/') ? this.config.baseUrl.slice(0, -1) : this.config.baseUrl ?? "";
    this.healthCheckEndpoint = this.config?.healthCheckEndpoint ?? "";
  }

  private async checkHealth(): Promise<boolean> {
    // If no health check endpoint is defined, assume the service is healthy.
    if (!this.healthCheckEndpoint) {
      return true;
    }

    const now = Date.now();
    // Use cached status if it's recent and healthy
    if (this.healthStatus.isHealthy && (now - this.healthStatus.lastChecked < this.healthCacheTTL)) {
      return true;
    }
    // If cached status is recent and unhealthy, don't re-check
    if (!this.healthStatus.isHealthy && (now - this.healthStatus.lastChecked < this.healthCacheTTL)) {
        return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}${this.healthCheckEndpoint}`);
      const isHealthy = response.ok; // Status 200-299
      this.healthStatus = { isHealthy, lastChecked: now };
      return isHealthy;
    } catch (error) {
      this.healthStatus = { isHealthy: false, lastChecked: now };
      return false;
    }
  }

  /**
     * Private helper to construct the request body dynamically based on templates.
     * This now correctly accepts all relevant request types.
     */
  private _buildRequestBody(request: GenerateRequest | GenerateStreamRequest | EmbedContentRequest, modelId: string): any {
    const modelConfig = this.config.models.find(m => m.id === modelId);
    
    // Determine which template to use based on the request type
    let requestBodyTemplate;
    if ('texts' in request) { // This is an EmbedContentRequest
        requestBodyTemplate = modelConfig?.embeddingRequestBodyTemplate || this.config.embeddingRequestBodyTemplate;
    } else { // This is a GenerateRequest or GenerateStreamRequest
        requestBodyTemplate = modelConfig?.requestBodyTemplate || this.config.requestBodyTemplate;
    }

    if (!requestBodyTemplate) {
        // Default behavior if no template is provided
        return {
            model: modelId,
            ...request,
        };
    }

    let bodyString = requestBodyTemplate.replace(/{{model}}/g, modelId);
    
    if ('prompt' in request) {
        bodyString = bodyString
            .replace(/"{{prompt}}"/g, JSON.stringify(request.prompt))
            .replace(/{{prompt}}/g, request.prompt)
            .replace(/"{{systemPrompt}}"/g, JSON.stringify(request.systemPrompt || ''))
            .replace(/{{systemPrompt}}/g, request.systemPrompt || '')
            .replace(/{{temperature}}/g, String(request.params?.temperature || 1.0))
            .replace(/{{maxTokens}}/g, String(request.params?.maxTokens || 512))
            .replace(/{{topP}}/g, String(request.params?.topP || 1.0));
    }

    if ('texts' in request) {
        bodyString = bodyString
            .replace(/"{{texts}}"/g, JSON.stringify(request.texts));
    }

    return JSON.parse(bodyString);
  }

  async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
    // This logic was fixed to correctly return a failure object instead of throwing an unhandled error.
    const isServerHealthy = await this.checkHealth();
    if (!isServerHealthy) {
      return {
        status: 'failed',
        provider: this.config.name,
        model: modelId,
        error: 'Custom server is unhealthy or unreachable.',
      };
    }

    // Find the specific model's configuration
    const modelConfig = this.config.models.find(m => m.id === modelId);

    // --- 1. Dynamically construct headers ---
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authHeaderName = this.config.authenticationHeader || 'Authorization';
    const authScheme = this.config.authenticationScheme || '';
    if (this.config.apiKey) {
      headers[authHeaderName] = `${authScheme}${this.config.apiKey}`;
    }

    // --- 2. Dynamically construct the request body ---
    // const requestBodyTemplate = modelConfig?.requestBodyTemplate || this.config.requestBodyTemplate;
    // let body: any;
    // if (requestBodyTemplate) {
    //   let bodyString = requestBodyTemplate
    //     .replace(/"{{prompt}}"/g, JSON.stringify(request.prompt))
    //     .replace(/{{prompt}}/g, request.prompt)
    //     .replace(/{{model}}/g, modelId);
    //   body = JSON.parse(bodyString);
    // } else {
    //   body = { model: modelId, prompt: request.prompt };
    // }
    const body = this._buildRequestBody(request, modelId);

    try {
      const response = await fetch(`${this.baseUrl}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Custom server returned an error: ${response.status} ${errorBody}`);
      }
      
      const responseData = await response.json();

      // TODO: Add a debuging option here to see the api response log 
      // console.log("RAW API RESPONSE:", JSON.stringify(responseData, null, 2));

      // --- 3. Dynamically extract the result from the response ---
      const responseExtractor = modelConfig?.responseExtractor || this.config.responseExtractor;
      let extractedData: string;
      if (responseExtractor) {
        extractedData = getNestedProperty(responseData, responseExtractor);
      } else {
        extractedData = responseData.data || responseData.text;
      }

      if (typeof extractedData !== 'string') {
        throw new Error(`Response extractor path "${this.config.responseExtractor}" did not yield a string.`);
      }

      return {
        status: 'completed',
        orchestratorJobId: responseData.jobId,
        provider: this.config.name,
        model: modelId,
        data: extractedData,
        error: responseData.error
      };
    } catch (error: any) {
      return {
        status: 'failed',
        provider: this.config.name,
        model: modelId,
        error: error.message || 'An unknown error occurred with the custom provider.',
      };
    }
  }

  async * generateStream(request: GenerateStreamRequest, modelId: string): AsyncGenerator<StreamGenerateResult> {
    const isHealthy = await this.checkHealth();
    if (!isHealthy) {
        yield { status: 'error', provider: this.config.name, model: modelId, error: 'Custom server is unhealthy or unreachable.' };
        return;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
    const authHeaderName = this.config.authenticationHeader || 'Authorization';
    const authScheme = this.config.authenticationScheme || '';
    if (this.config.apiKey) {
        headers[authHeaderName] = `${authScheme} ${this.config.apiKey}`.trim();
    }

    const body = this._buildRequestBody(request, modelId);
    // Add a 'stream: true' key, a common convention for streaming APIs
    body.stream = true;

    try {
        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok || !response.body) {
            throw new Error(`Custom server returned an error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const textChunk = decoder.decode(value, { stream: true });
            yield {
                status: 'streaming',
                provider: this.config.name,
                model: modelId,
                data: textChunk,
            };
        }

        yield { status: 'completed', provider: this.config.name, model: modelId };

    } catch (error: any) {
        yield { status: 'error', provider: this.config.name, model: modelId, error: error.message };
    }
  }

  /**
     * NEW: Generates embeddings using a configurable custom endpoint.
     */
  async embedContent(request: EmbedContentRequest, modelId: string): Promise<EmbedContentResponse> {
    const isServerHealthy = await this.checkHealth();
    if (!isServerHealthy) {
        return { success: false, error: 'Custom server is unhealthy or unreachable.' };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authHeaderName = this.config.authenticationHeader || 'Authorization';
    const authScheme = this.config.authenticationScheme || '';
    if (this.config.apiKey) {
        headers[authHeaderName] = `${authScheme} ${this.config.apiKey}`.trim();
    }

    const body = this._buildRequestBody(request, modelId);
    const endpoint = this.config.embeddingEndpoint || this.baseUrl; // Use a specific embedding endpoint if provided

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Custom embedding endpoint returned an error: ${response.status} ${errorBody}`);
        }

        const responseData = await response.json();
        const modelConfig = this.config.models.find(m => m.id === modelId);
        const responseExtractor = modelConfig?.embeddingResponseExtractor || this.config.embeddingResponseExtractor;
        
        let embeddings: number[][];
        if (responseExtractor) {
            embeddings = getNestedProperty(responseData, responseExtractor);
        } else {
            // Heuristic to find the data
            embeddings = responseData.embeddings || responseData.data;
        }

        if (!Array.isArray(embeddings) || (embeddings.length > 0 && !Array.isArray(embeddings[0]))) {
            return { success: false, error: 'Extracted embedding data is not a valid array of arrays.' };
        }

        return { success: true, embeddings };

    } catch (error: any) {
        return { success: false, error: error.message };
    }
  }

  async countTokens(request: CountTokensRequest): Promise<CountTokensResponse> {
    return { success: false, error: 'Token counting is not supported for custom providers.' };
  }

  public async endChatSession(sessionId: string): Promise<void> {
    // Custom adapter is stateless, so this is a no-op.
    // It exists to fulfill the interface contract.
    return;
  } 
  
  async checkJobStatus(providerJobId: string): Promise<JobStatusResult> {
    try {
        const response = await fetch(`${this.baseUrl}/job/${providerJobId}`);
        if (!response.ok) { throw new Error(`Custom server job status error: ${response.status}`); }
        
        const responseData = await response.json();
        return {
            status: responseData.status,
            data: responseData.data,
            error: responseData.error,
        };
    } catch (error: any) {
        return { status: 'failed', error: error.message };
    }
  }
}