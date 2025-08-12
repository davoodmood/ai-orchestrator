import { GenerateRequest, GenerateResult, IProviderAdapter } from '../types';

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
    const isServerHealthy = await this.checkHealth();
    if (!isServerHealthy) {
      return {
        success: false,
        provider: 'custom',
        model: modelId,
        data: '',
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
        success: true,
        provider: 'custom',
        model: modelId,
        data: responseData.data, // Assuming the custom server returns { "data": "..." }
      };
    } catch (error: any) {
      return {
        success: false,
        provider: 'custom',
        model: modelId,
        data: '',
        error: error.message || 'An unknown error occurred with the custom server.',
      };
    }
  }
}