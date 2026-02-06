import type { LLMConfig, LLMProvider } from './types.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { LLMError } from '../utils/errors.js';

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      throw new LLMError('OpenAI provider not yet implemented', 'openai');
    case 'local':
      throw new LLMError('Local provider not yet implemented', 'local');
    default:
      throw new LLMError(`Unknown provider: ${config.provider}`, config.provider);
  }
}

export { AnthropicProvider } from './providers/AnthropicProvider.js';
export type { LLMProvider, LLMConfig, LLMRequest, LLMResponse } from './types.js';
