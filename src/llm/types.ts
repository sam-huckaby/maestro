import { z } from 'zod';

export const LLMProviderTypeSchema = z.enum(['anthropic', 'openai', 'local']);
export type LLMProviderType = z.infer<typeof LLMProviderTypeSchema>;

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export interface Message {
  role: MessageRole;
  content: string;
}

export interface LLMConfig {
  provider: LLMProviderType;
  apiKey?: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
}

export interface LLMRequest {
  messages: Message[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  stopReason: StopReason;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence';

export interface LLMProvider {
  readonly type: LLMProviderType;
  readonly model: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
}

export interface StreamingLLMProvider extends LLMProvider {
  stream(request: LLMRequest): AsyncIterable<string>;
}
