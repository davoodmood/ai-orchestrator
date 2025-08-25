import { createHash } from 'crypto';
import { OrchestratorConfig, GenerateRequest, GenerateResult, ProviderConfig, ModelConfig, JobStatusResult, IProviderAdapter } from './types';
import { OpenAIAdapter } from './adapters/openai';
import { GoogleAdapter } from './adapters/google';
import { CustomAdapter } from './adapters/custom';
// import { AnthropicAdapter } from './adapters/anthropic';
// import { DeepSeekAdapter } from './adapters/deepseek';

interface ActiveJob {
    providerName: string;
    providerJobId: string;
}

export class AIOrchestrator {
    private config: OrchestratorConfig;
    private adapters: Map<string, IProviderAdapter> = new Map();
    private logger: any;
    private activeJobs: Map<string, ActiveJob> = new Map();
  
    constructor(config: OrchestratorConfig) {
      this.config = config;
      this.logger = config.logger || console;
  
      this.initializeAdapters();
      this.logger.info('AIOrchestrator initialized.');
    }
  
    private initializeAdapters() {
      // ... (adapter initialization logic remains the same)
      for (const provider of this.config.providers) {
        switch (provider.name.toLowerCase()) {
          case 'openai': this.adapters.set('openai', new OpenAIAdapter(provider.apiKey)); break;
          case 'google': this.adapters.set('google', new GoogleAdapter(provider.apiKey)); break;
          // case 'anthropic': this.adapters.set('anthropic', new AnthropicAdapter(provider.apiKey)); break;
          // case 'deepseek': this.adapters.set('deepseek', new DeepSeekAdapter(provider.apiKey)); break;
          case 'custom':
            if (provider.baseUrl) {
              this.adapters.set('custom', new CustomAdapter(provider));
            } else { this.logger.error('Custom provider requires a `baseUrl`.'); }
            break;
          default: this.logger.warn(`No adapter found for provider: ${provider.name}`);
        }
      }
    }
  
    public async generate(request: GenerateRequest): Promise<GenerateResult> {
      this.logger.info(`Received generate request: ${JSON.stringify(request)}`);
      const candidateProviders = this.getSortedProviders(request);
  
      if (candidateProviders.length === 0) {
        return { status: 'failed', provider: 'none', model: 'none', error: 'No suitable provider found.' };
      }
  
      for (const { provider, model } of candidateProviders) {
        const adapter = this.adapters.get(provider.name);
        if (!adapter) {
          this.logger.error(`Adapter not initialized for provider: ${provider.name}`);
          continue;
        }
        
        try {
          this.logger.info(`Attempting to generate with ${provider.name} using model ${model.id}`);
          const result = await adapter.generate(request, model.id);
  
          if (result.status === 'pending' && result.orchestratorJobId) {
            // The adapter returned a job ID. Store it for polling.
            const orchestratorJobId = this.createOrchestratorJobId(provider.name, result.orchestratorJobId);
            this.activeJobs.set(orchestratorJobId, {
              providerName: provider.name,
              providerJobId: result.orchestratorJobId,
            });
            this.logger.info(`Started async job with ${provider.name}. Orchestrator Job ID: ${orchestratorJobId}`);
            return { ...result, orchestratorJobId };
          }
          
          if (result.status === 'completed') {
            this.logger.info(`Successfully generated content with ${provider.name}`);
            return result;
          }
  
          this.logger.warn(`Generation failed with ${provider.name}: ${result.error}. Trying next provider.`);
        } catch (error: any) {
          this.logger.error(`Exception with provider ${provider.name}: ${error.message}. Trying next provider.`);
        }
      }
  
      return { status: 'failed', provider: 'none', model: 'none', error: 'All configured providers failed.' };
    }
    
    public async getJobResult(orchestratorJobId: string): Promise<JobStatusResult> {
      const job = this.activeJobs.get(orchestratorJobId);
      if (!job) {
        return { status: 'failed', error: 'Job not found or already completed.' };
      }
  
      const adapter = this.adapters.get(job.providerName);
      if (!adapter || !adapter.checkJobStatus) {
        return { status: 'failed', error: `Provider '${job.providerName}' does not support job status checks.` };
      }
  
      const result = await adapter.checkJobStatus(job.providerJobId);
  
      // If the job is finished (completed or failed), remove it from the active list.
      if (result.status === 'completed' || result.status === 'failed') {
        this.activeJobs.delete(orchestratorJobId);
        this.logger.info(`Job ${orchestratorJobId} finished with status: ${result.status}.`);
      }
  
      return result;
    }

    private createOrchestratorJobId(providerName: string, providerJobId: string): string {
      // Create a consistent, unique hash to use as our internal job ID.
      return createHash('sha256').update(`${providerName}-${providerJobId}`).digest('hex');
    }


    private getSortedProviders(request: GenerateRequest): { provider: ProviderConfig, model: ModelConfig }[] {
      // ... (this logic remains the same)
      const { type, strategy = 'cost', quality } = request;
      let candidates = this.config.providers
      .flatMap(p => p.models.map(m => ({ provider: p, model: m })))
      .filter(({ model }) => model.type === type);
      if (quality) { candidates = candidates.filter(({ model }) => model.quality === quality); }
      switch (strategy) {
          case 'latency': candidates.sort((a, b) => (a.model.avg_latency_ms ?? Infinity) - (b.model.avg_latency_ms ?? Infinity)); break;
          case 'quality': const qualityOrder = { 'high': 1, 'medium': 2, 'low': 3 }; candidates.sort((a, b) => qualityOrder[a.model.quality] - qualityOrder[b.model.quality]); break;
          case 'cost': default: candidates.sort((a, b) => a.model.cost - b.model.cost); break;
      }
      this.logger.info(`Provider priority list for strategy '${strategy}': ${candidates.map(c => `${c.provider.name}/${c.model.id}`).join(', ')}`);
      return candidates;
    }
  }