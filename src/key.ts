import { createHash } from 'crypto';
import type { CacheableMessage } from './types';

// Output-affecting params to include in key
const INCLUDE_PARAMS = new Set([
  'temperature', 'top_p', 'max_tokens', 'max_completion_tokens',
  'tools', 'tool_choice', 'response_format', 'stop', 'seed',
  'system', 'top_k',
]);

// Params to always exclude (don't affect output)
const EXCLUDE_PARAMS = new Set([
  'stream', 'stream_options', 'n', 'user', 'api_key', 'timeout',
  'request_id', 'idempotency_key', 'organization', 'max_retries',
]);

function normalizeMessage(msg: CacheableMessage): { role: string; content: string | unknown[] } {
  const role = msg.role.toLowerCase().trim();
  const content = typeof msg.content === 'string'
    ? msg.content.trim().normalize('NFC')
    : msg.content;
  return { role, content };
}

export function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(sortedStringify).join(',') + ']';
  }
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + sortedStringify((value as Record<string, unknown>)[k]));
  return '{' + sorted.join(',') + '}';
}

export function buildKey(
  messages: CacheableMessage[],
  model: string,
  params?: Record<string, unknown>,
): string {
  const normalizedMessages = messages.map(normalizeMessage);

  const filteredParams: Record<string, unknown> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (INCLUDE_PARAMS.has(k) && !EXCLUDE_PARAMS.has(k)) {
        filteredParams[k] = v;
      }
    }
  }

  const canonical = {
    messages: normalizedMessages,
    model: model.toLowerCase().trim(),
    params: filteredParams,
  };

  const digest = createHash('sha256').update(sortedStringify(canonical)).digest('hex');
  return digest;
}
