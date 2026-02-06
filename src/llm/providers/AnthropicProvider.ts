import Anthropic from '@anthropic-ai/sdk';
import type { LLMConfig, LLMProvider, LLMRequest, LLMResponse, StopReason } from '../types.js';
import { LLMError, LLMAuthenticationError, LLMRateLimitError } from '../../utils/errors.js';

export class AnthropicProvider implements LLMProvider {
  readonly type = 'anthropic' as const;
  readonly model: string;

  private client: Anthropic;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.model = config.model;

    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LLMAuthenticationError('anthropic');
    }

    this.client = new Anthropic({
      apiKey,
      timeout: config.timeout,
    });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? this.config.maxTokens,
        temperature: request.temperature ?? this.config.temperature,
        system: request.system,
        messages: request.messages.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        stop_sequences: request.stopSequences,
      });

      const textContent = response.content.find((block) => block.type === 'text');
      const content = textContent?.type === 'text' ? textContent.text : '';

      return {
        content,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        stopReason: this.mapStopReason(response.stop_reason),
      };
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new LLMAuthenticationError('anthropic');
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new LLMRateLimitError('anthropic');
      }
      if (error instanceof Anthropic.APIError) {
        throw new LLMError(`Anthropic API error: ${error.message}`, 'anthropic', {
          status: error.status,
        });
      }
      throw new LLMError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        'anthropic'
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Make a minimal request to check availability
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  private mapStopReason(reason: string | null): StopReason {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'max_tokens':
        return 'max_tokens';
      case 'stop_sequence':
        return 'stop_sequence';
      default:
        return 'end_turn';
    }
  }
}
