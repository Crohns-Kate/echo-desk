/**
 * LLM Provider - Abstraction layer for AI model access
 * Supports OpenAI and Anthropic with automatic fallback
 */

import { env } from '../utils/env';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface LLMResponse {
  content: string;
  provider: 'openai' | 'anthropic' | 'fallback';
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// Detect which provider is available
function getAvailableProvider(): 'openai' | 'anthropic' | null {
  const hasOpenAI = !!env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  console.log(`[LLM] Checking providers - OpenAI: ${hasOpenAI}, Anthropic: ${hasAnthropic}`);

  if (env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';

  console.warn('[LLM] ⚠️  No LLM API keys configured (OPENAI_API_KEY or ANTHROPIC_API_KEY)');
  return null;
}

/**
 * Call OpenAI API
 */
async function callOpenAI(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const { OPENAI_API_KEY, OPENAI_BASE_URL } = env;
  const baseUrl = OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = options.model || 'gpt-4o-mini';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 500
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  return {
    content,
    provider: 'openai',
    model,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens
    } : undefined
  };
}

/**
 * Call Anthropic API
 */
async function callAnthropic(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key not configured');

  const model = options.model || 'claude-3-haiku-20240307';

  // Convert messages to Anthropic format
  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 500,
      system: systemMessage,
      messages: anthropicMessages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';

  return {
    content,
    provider: 'anthropic',
    model,
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens
    } : undefined
  };
}

/**
 * Main LLM completion function with automatic provider selection
 */
export async function complete(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const provider = getAvailableProvider();

  if (!provider) {
    console.warn('[LLM] No AI provider configured, returning fallback');
    return {
      content: '',
      provider: 'fallback',
      model: 'none'
    };
  }

  try {
    if (provider === 'openai') {
      return await callOpenAI(messages, options);
    } else {
      return await callAnthropic(messages, options);
    }
  } catch (error) {
    console.error(`[LLM] ${provider} failed:`, error);

    // Try fallback to other provider if available
    const fallbackProvider = provider === 'openai' ? 'anthropic' : 'openai';
    const hasFallback = fallbackProvider === 'openai'
      ? !!env.OPENAI_API_KEY
      : !!process.env.ANTHROPIC_API_KEY;

    if (hasFallback) {
      console.log(`[LLM] Trying fallback to ${fallbackProvider}`);
      try {
        if (fallbackProvider === 'openai') {
          return await callOpenAI(messages, options);
        } else {
          return await callAnthropic(messages, options);
        }
      } catch (fallbackError) {
        console.error(`[LLM] Fallback ${fallbackProvider} also failed:`, fallbackError);
      }
    }

    // Return empty fallback response
    return {
      content: '',
      provider: 'fallback',
      model: 'none'
    };
  }
}

/**
 * Quick completion helper for single prompts
 */
export async function quickComplete(
  prompt: string,
  systemPrompt?: string,
  options: LLMOptions = {}
): Promise<string> {
  const messages: LLMMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await complete(messages, options);
  return response.content;
}

/**
 * Check if LLM is available
 */
export function isLLMAvailable(): boolean {
  return getAvailableProvider() !== null;
}

/**
 * Get current provider name
 */
export function getCurrentProvider(): string {
  return getAvailableProvider() || 'none';
}
