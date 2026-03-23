import { buildKey } from './key';
import { LRUStore } from './lru-store';
import type {
  CacheableMessage,
  CacheableResponse,
  CacheEntry,
  ResponseCache,
  ResponseCacheOptions,
} from './types';

function estimateTokens(messages: CacheableMessage[]): number {
  return messages.reduce((sum, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + Math.ceil(text.length / 4);
  }, 0);
}

function extractResponse(result: unknown): CacheableResponse {
  const r = result as Record<string, unknown>;
  const choices = r?.['choices'] as Array<Record<string, unknown>> | undefined;
  const contentParts = r?.['content'] as Array<Record<string, unknown>> | undefined;
  const usage = r?.['usage'] as Record<string, unknown> | undefined;

  const content =
    (choices?.[0]?.['message'] as Record<string, unknown> | undefined)?.['content'] as string ??
    (contentParts?.[0]?.['text'] as string | undefined) ??
    JSON.stringify(result);

  return {
    content: typeof content === 'string' ? content : JSON.stringify(content),
    model: (r?.['model'] as string | undefined) ?? '',
    usage: {
      inputTokens: (usage?.['prompt_tokens'] as number | undefined) ?? (usage?.['input_tokens'] as number | undefined),
      outputTokens: (usage?.['completion_tokens'] as number | undefined) ?? (usage?.['output_tokens'] as number | undefined),
    },
  };
}

export function createCache(options?: ResponseCacheOptions): ResponseCache {
  const maxEntries = options?.eviction?.maxEntries ?? 1000;
  const ttlMs = options?.eviction?.ttlMs ?? 0;
  const store = new LRUStore(maxEntries, ttlMs);
  let hits = 0;
  let misses = 0;

  const cache: ResponseCache = {
    get(messages: CacheableMessage[], model: string, params?: Record<string, unknown>): CacheEntry | null {
      const key = buildKey(messages, model, params);
      const entry = store.get(key);
      if (entry) {
        hits++;
        entry.hitCount++;
        entry.lastAccessedAt = Date.now();
        return entry;
      }
      misses++;
      return null;
    },

    set(
      messages: CacheableMessage[],
      model: string,
      params: Record<string, unknown> | undefined,
      response: CacheableResponse,
    ): void {
      const key = buildKey(messages, model, params);
      const entry: CacheEntry = {
        key,
        response,
        model: response.model || model,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        hitCount: 0,
        inputTokens: response.usage?.inputTokens ?? estimateTokens(messages),
        outputTokens: response.usage?.outputTokens ?? Math.ceil(response.content.length / 4),
      };
      store.set(key, entry);
    },

    wrap<T extends object>(
      client: T,
      wrapOptions?: {
        extractMessages?: (args: unknown[]) => { messages: CacheableMessage[]; model: string; params: Record<string, unknown> };
        extractResponse?: (response: unknown) => CacheableResponse;
      },
    ): T {
      const defaultExtractMessages = (args: unknown[]) => {
        const callParams = (args[0] ?? {}) as Record<string, unknown>;
        const messages = (callParams['messages'] ?? []) as CacheableMessage[];
        const model = (callParams['model'] ?? '') as string;
        return { messages, model, params: callParams };
      };
      const doExtractResponse = wrapOptions?.extractResponse ?? extractResponse;
      const doExtractMessages = wrapOptions?.extractMessages ?? defaultExtractMessages;

      return new Proxy(client, {
        get(target, prop) {
          if (prop === 'chat') {
            const chatTarget = (target as Record<string, unknown>)['chat'];
            return new Proxy(chatTarget as object, {
              get(ct, chatProp) {
                if (chatProp === 'completions') {
                  const compTarget = (ct as Record<string, unknown>)['completions'];
                  return new Proxy(compTarget as object, {
                    get(cpt, compProp) {
                      if (compProp === 'create') {
                        return async (...args: unknown[]) => {
                          const { messages, model, params } = doExtractMessages(args);
                          const cached = cache.get(messages, model, params);
                          if (cached) return cached.response;
                          const createFn = (cpt as Record<string, (...a: unknown[]) => unknown>)['create'];
                          const result = await createFn(...args);
                          cache.set(messages, model, params, doExtractResponse(result));
                          return result;
                        };
                      }
                      return (cpt as Record<string, unknown>)[compProp as string];
                    },
                  });
                }
                return (ct as Record<string, unknown>)[chatProp as string];
              },
            });
          }
          return (target as Record<string, unknown>)[prop as string];
        },
      }) as T;
    },

    stats() {
      const total = hits + misses;
      const entries = store.all();
      const priceIn = options?.pricePerMTokInput ?? 2.50;
      const priceOut = options?.pricePerMTokOutput ?? 10.00;
      const tokensSaved = entries.reduce(
        (sum, e) => sum + e.hitCount * (e.inputTokens + e.outputTokens),
        0,
      );
      const estimatedCostSaved = entries.reduce(
        (sum, e) =>
          sum +
          e.hitCount * (e.inputTokens / 1_000_000 * priceIn + e.outputTokens / 1_000_000 * priceOut),
        0,
      );
      return {
        hits,
        misses,
        hitRate: total > 0 ? hits / total : 0,
        totalEntries: entries.length,
        tokensSaved,
        estimatedCostSaved,
      };
    },

    invalidate(model?: string): number {
      return store.invalidate(model);
    },

    clear(): void {
      store.clear();
      hits = 0;
      misses = 0;
    },

    delete(key: string): boolean {
      return store.delete(key);
    },

    has(key: string): boolean {
      return store.peek(key) !== null;
    },

    getByKey(key: string): CacheEntry | null {
      return store.get(key);
    },

    buildKey,

    serialize() {
      return { entries: store.all(), stats: { hits, misses }, version: 1 as const };
    },

    get size() {
      return store.size();
    },
  };

  return cache;
}
