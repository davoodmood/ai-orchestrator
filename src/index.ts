import { OrchestratorConfig, GenerateRequest, GenerateResult, ProviderConfig, ModelConfig } from './types';
import { OpenAIAdapter } from './adapters/openai';
// import { GoogleAdapter } from './adapters/google'; // To be implemented

export class AIOrchestrator {
  private config: OrchestratorConfig;
  private adapters: Map<string, any> = new Map();
  private logger: any;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.logger = config.logger || console; // Default to console if no logger is provided

    this.initializeAdapters();
    this.logger.info('AIOrchestrator initialized.');
  }

  private initializeAdapters() {
    for (const provider of this.config.providers) {
      switch (provider.name.toLowerCase()) {
        case 'openai':
          this.adapters.set('openai', new OpenAIAdapter(provider.apiKey));
          break;
        // case 'google':
        //   this.adapters.set('google', new GoogleAdapter(provider.apiKey));
        //   break;
        default:
          this.logger.warn(`No adapter found for provider: ${provider.name}`);
      }
    }
  }

  public async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.logger.info(`Received generate request: ${JSON.stringify(request)}`);

    const candidateProviders = this.getSortedProviders(request);

    if (candidateProviders.length === 0) {
      return {
        success: false,
        provider: 'none',
        model: 'none',
        data: '',
        error: 'No suitable provider found for the given request and strategy.',
      };
    }

    for (const { provider, model } of candidateProviders) {
      try {
        const adapter = this.adapters.get(provider.name);
        if (!adapter) {
          this.logger.error(`Adapter not initialized for provider: ${provider.name}`);
          continue; // Try next provider
        }

        this.logger.info(`Attempting to generate with ${provider.name} using model ${model.id}`);
        const result = await adapter.generate(request, model.id);

        if (result.success) {
          this.logger.info(`Successfully generated content with ${provider.name}`);
          return result;
        } else {
          // This case handles non-exception failures from the adapter
          this.logger.warn(`Generation failed with ${provider.name}: ${result.error}. Trying next provider.`);
        }
      } catch (error: any) {
        this.logger.error(`Exception with provider ${provider.name}: ${error.message}. Trying next provider.`);
      }
    }

    // If all providers fail
    return {
      success: false,
      provider: 'none',
      model: 'none',
      data: '',
      error: 'All configured providers failed to generate a response.',
    };
  }

  private getSortedProviders(request: GenerateRequest): { provider: ProviderConfig, model: ModelConfig }[] {
    const { type, strategy = 'cost', quality } = request;

    let candidates = this.config.providers
      .flatMap(p => p.models.map(m => ({ provider: p, model: m })))
      .filter(({ model }) => model.type === type);
    
    // Filter by quality if specified
    if (quality) {
        candidates = candidates.filter(({ model }) => model.quality === quality);
    }

    // Sort by the chosen strategy
    switch (strategy) {
      case 'latency':
        // Sort by average latency, ascending. Models without latency info are last.
        candidates.sort((a, b) => (a.model.avg_latency_ms ?? Infinity) - (b.model.avg_latency_ms ?? Infinity));
        break;
      case 'quality':
        // Custom quality sorting: high > medium > low
        const qualityOrder = { 'high': 1, 'medium': 2, 'low': 3 };
        candidates.sort((a, b) => qualityOrder[a.model.quality] - qualityOrder[b.model.quality]);
        break;
      case 'cost':
      default:
        // Sort by cost, ascending.
        candidates.sort((a, b) => a.model.cost - b.model.cost);
        break;
    }

    this.logger.info(`Provider priority list for strategy '${strategy}': ${candidates.map(c => `${c.provider.name}/${c.model.id}`).join(', ')}`);
    return candidates;
  }
}