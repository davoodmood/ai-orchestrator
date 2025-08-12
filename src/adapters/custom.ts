import { GenerateRequest, GenerateResult, IProviderAdapter, JobStatusResult } from '../types';

// ... (Health check logic remains the same)
interface HealthStatus { isHealthy: boolean; lastChecked: number; }

export class CustomAdapter implements IProviderAdapter {
  private baseUrl: string;
  private healthCheckEndpoint: string;
  private healthStatus: HealthStatus = { isHealthy: false, lastChecked: 0 };
  private readonly healthCacheTTL = 60 * 1000;

  constructor(baseUrl: string, healthCheckEndpoint: string = '/health') {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.healthCheckEndpoint = healthCheckEndpoint;
  }

  private async checkHealth(): Promise<boolean> { /* ... health check logic ... */ return true; }

  async generate(request: GenerateRequest, modelId: string): Promise<GenerateResult> {
    const isServerHealthy = await this.checkHealth();
    if (!isServerHealthy) {
      return { status: 'failed', provider: 'custom', model: modelId, error: 'Custom server is unhealthy.' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, model: modelId }),
      });

      if (!response.ok) { throw new Error(`Custom server error: ${response.status}`); }
      
      const responseData = await response.json(); // Expects { status: 'completed'|'pending', data?: '...', jobId?: '...' }

      return {
        status: responseData.status,
        orchestratorJobId: responseData.jobId,
        provider: 'custom',
        model: modelId,
        data: responseData.data,
      };
    } catch (error: any) {
      return { status: 'failed', provider: 'custom', model: modelId, error: error.message };
    }
  }

  async checkJobStatus(providerJobId: string): Promise<JobStatusResult> {
    try {
        const response = await fetch(`${this.baseUrl}/job/${providerJobId}`);
        if (!response.ok) { throw new Error(`Custom server job status error: ${response.status}`); }
        
        const responseData = await response.json(); // Expects { status: 'pending'|'completed'|'failed', data?: '...' }
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