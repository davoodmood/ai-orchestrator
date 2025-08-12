export interface ModelConfig {
    id: string;
    type: 'text' | 'image' | 'audio' | 'video'; // Added 'video' type
    cost: number;
    quality: 'low' | 'medium' | 'high';
    avg_latency_ms?: number;
}
  
export interface ProviderConfig {
    name: string;
    apiKey: string;
    models: ModelConfig[];
    // Optional properties for custom providers
    baseUrl?: string;
    healthCheckEndpoint?: string;
  }
  
export interface OrchestratorConfig {
    providers: ProviderConfig[];
    logger?: any; // Allow consumer to pass in a logger like pino or winston
}
  
export interface GenerateRequest {
    type: 'text' | 'image' | 'audio' | 'video';
    prompt: string;
    strategy?: 'cost' | 'latency' | 'quality';
    quality?: 'low' | 'medium' | 'high';
}
  
export interface GenerateResult {
    success: boolean;
    provider: string;
    model: string;
    data: string | Buffer;
    error?: string;
}
  
export interface IProviderAdapter {
    generate(request: GenerateRequest, modelId: string): Promise<GenerateResult>;
}