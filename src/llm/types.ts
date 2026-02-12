import { z } from 'zod';
import type { ToolDefinition } from '../tools/types.js';

export const LLMProviderTypeSchema = z.enum(['anthropic', 'openai', 'local']);
export type LLMProviderType = z.infer<typeof LLMProviderTypeSchema>;

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

// Content block types for multi-modal responses
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ToolUseBlock;

// Tool result content for user messages
export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type MessageContent = string | ContentBlock[] | ToolResultContent[];

export interface Message {
  role: MessageRole;
  content: MessageContent;
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
  tools?: ToolDefinition[];
}

export interface LLMResponse {
  content: string | ContentBlock[];
  model: string;
  usage: TokenUsage;
  stopReason: StopReason;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

export interface LLMProvider {
  readonly type: LLMProviderType;
  readonly model: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
}

export interface StreamingLLMProvider extends LLMProvider {
  stream(request: LLMRequest): AsyncIterable<string>;
}
