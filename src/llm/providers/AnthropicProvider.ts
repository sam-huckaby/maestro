import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMConfig,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  StopReason,
  ContentBlock,
  MessageContent,
} from '../types.js';
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
      // Build the messages array, handling both string and structured content
      const messages = request.messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: this.formatMessageContent(msg.content),
      }));

      // Build the API request
      const apiRequest: Anthropic.MessageCreateParams = {
        model: this.model,
        max_tokens: request.maxTokens ?? this.config.maxTokens,
        temperature: request.temperature ?? this.config.temperature,
        system: request.system,
        messages,
        stop_sequences: request.stopSequences,
      };

      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        apiRequest.tools = request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema as Anthropic.Tool['input_schema'],
        }));
      }

      const response = await this.client.messages.create(apiRequest);

      // Check if response includes tool use
      const hasToolUse = response.content.some((block) => block.type === 'tool_use');

      if (hasToolUse) {
        // Return full content blocks for tool use handling
        const contentBlocks: ContentBlock[] = response.content.map((block) => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text };
          } else if (block.type === 'tool_use') {
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            };
          }
          // Handle any other block types by converting to text
          return { type: 'text' as const, text: '' };
        });

        return {
          content: contentBlocks,
          model: response.model,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          },
          stopReason: this.mapStopReason(response.stop_reason),
        };
      }

      // No tool use - return simple string content
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

  /**
   * Format message content for the Anthropic API
   */
  private formatMessageContent(
    content: MessageContent
  ): string | Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam> {
    if (typeof content === 'string') {
      return content;
    }

    // Handle array content (ContentBlock[] or ToolResultContent[])
    return content.map((block) => {
      if ('type' in block) {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text } as Anthropic.TextBlockParam;
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input,
          } as Anthropic.ToolUseBlockParam;
        }
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          } as Anthropic.ToolResultBlockParam;
        }
      }
      // Fallback
      return { type: 'text' as const, text: String(block) } as Anthropic.TextBlockParam;
    });
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
      case 'tool_use':
        return 'tool_use';
      default:
        return 'end_turn';
    }
  }
}
