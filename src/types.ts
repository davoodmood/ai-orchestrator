export interface ModelConfig {
    id: string;
    type: 'text' | 'image' | 'audio';
    cost: number; // A numeric value for sorting (e.g., cost per 1M tokens, or per image)
    quality: 'low' | 'medium' | 'high';
    avg_latency_ms?: number;
}
  
export interface ProviderConfig {
    name: string;
    apiKey: string;
    models: ModelConfig[];
}
  
export interface OrchestratorConfig {
    providers: ProviderConfig[];
    logger?: any; // Allow consumer to pass in a logger like pino or winston
}
  
export interface GenerateRequest {
    type: 'text' | 'image' | 'audio';
    prompt: string;
    strategy?: 'cost' | 'latency' | 'quality';
    quality?: 'low' | 'medium' | 'high';
}
  
export interface GenerateResult {
    success: boolean;
    provider: string;
    model: string;
    data: string | Buffer; // string for text/image_url, Buffer for audio
    error?: string;
}
  
export interface IProviderAdapter {
    generate(request: GenerateRequest, modelId: string): Promise<GenerateResult>;
}