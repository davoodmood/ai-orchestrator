import { GenerateRequest, GenerateResult, IProviderAdapter, JobStatusResult, ProviderConfig } from '../types';

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

    // --- 1. Dynamically construct headers ---
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authHeaderName = this.config.authenticationHeader || 'Authorization';
    const authScheme = this.config.authenticationScheme || '';
    if (this.config.apiKey) {
      headers[authHeaderName] = `${authScheme}${this.config.apiKey}`;
    }

    // --- 2. Dynamically construct the request body ---
    let body: any;
    if (this.config.requestBodyTemplate) {
      let bodyString = this.config.requestBodyTemplate
        .replace(/"{{prompt}}"/g, JSON.stringify(request.prompt))
        .replace(/{{prompt}}/g, request.prompt)
        .replace(/{{model}}/g, modelId);
      body = JSON.parse(bodyString);
    } else {
      body = { model: modelId, prompt: request.prompt };
    }

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

      // --- 3. Dynamically extract the result from the response ---
      let extractedData: string;
      if (this.config.responseExtractor) {
        extractedData = getNestedProperty(responseData, this.config.responseExtractor);
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