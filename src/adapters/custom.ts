import { GenerateRequest, GenerateResult, IProviderAdapter, JobStatusResult } from '../types';

interface HealthStatus {
  isHealthy: boolean;
  lastChecked: number;
}

export class CustomAdapter implements IProviderAdapter {
  private baseUrl: string;
  private healthCheckEndpoint: string;
  private healthStatus: HealthStatus = { isHealthy: false, lastChecked: 0 };
  private readonly healthCacheTTL = 60 * 1000; // Cache health status for 60 seconds

  constructor(baseUrl: string, healthCheckEndpoint: string = '/health') {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.healthCheckEndpoint = healthCheckEndpoint;
  }

  private async checkHealth(): Promise<boolean> {
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
        provider: 'custom',
        model: modelId,
        error: 'Custom server is unhealthy or unreachable.',
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, model: modelId }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Custom server returned an error: ${response.status} ${errorBody}`);
      }
      
      const responseData = await response.json();

      return {
        status: responseData.status,
        orchestratorJobId: responseData.jobId,
        provider: 'custom',
        model: modelId,
        data: responseData.data,
        error: responseData.error,
      };
    } catch (error: any) {
      return {
        status: 'failed',
        provider: 'custom',
        model: modelId,
        error: error.message || 'An unknown error occurred with the custom server.',
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