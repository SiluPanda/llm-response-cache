import { describe, it, expect, vi } from 'vitest';
import { createCache } from '../cache';
import { buildKey } from '../key';
import type { CacheableMessage, CacheableResponse } from '../types';

const msgs: CacheableMessage[] = [
  { role: 'user', content: 'Hello, world' },
];

const response: CacheableResponse = {
  content: 'Hi there!',
  model: 'gpt-4',
  usage: { inputTokens: 10, outputTokens: 5 },
};

describe('buildKey', () => {
  it('returns the same key for the same messages and model regardless of param order', () => {
    const key1 = buildKey(msgs, 'gpt-4', { temperature: 0.7, max_tokens: 100 });
    const key2 = buildKey(msgs, 'gpt-4', { max_tokens: 100, temperature: 0.7 });
    expect(key1).toBe(key2);
  });

  it('returns a different key for a different model', () => {
    const key1 = buildKey(msgs, 'gpt-4');
    const key2 = buildKey(msgs, 'gpt-3.5-turbo');
    expect(key1).not.toBe(key2);
  });

  it('returns a different key for different messages', () => {
    const msgs2: CacheableMessage[] = [{ role: 'user', content: 'Different message' }];
    const key1 = buildKey(msgs, 'gpt-4');
    const key2 = buildKey(msgs2, 'gpt-4');
    expect(key1).not.toBe(key2);
  });

  it('excludes non-output-affecting params from the key', () => {
    const key1 = buildKey(msgs, 'gpt-4', { stream: true });
    const key2 = buildKey(msgs, 'gpt-4', { stream: false });
    expect(key1).toBe(key2);
  });

  it('normalizes model casing', () => {
    const key1 = buildKey(msgs, 'GPT-4');
    const key2 = buildKey(msgs, 'gpt-4');
    expect(key1).toBe(key2);
  });

  it('normalizes message role casing', () => {
    const key1 = buildKey([{ role: 'User', content: 'Hello, world' }], 'gpt-4');
    const key2 = buildKey([{ role: 'user', content: 'Hello, world' }], 'gpt-4');
    expect(key1).toBe(key2);
  });

  it('returns a 64-char hex string (SHA-256)', () => {
    const key = buildKey(msgs, 'gpt-4');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cache get/set', () => {
  it('returns null on a miss', () => {
    const cache = createCache();
    const result = cache.get(msgs, 'gpt-4');
    expect(result).toBeNull();
  });

  it('returns the entry after set', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, response);
    const entry = cache.get(msgs, 'gpt-4');
    expect(entry).not.toBeNull();
    expect(entry!.response.content).toBe('Hi there!');
  });

  it('increments hitCount on repeated gets', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, response);
    cache.get(msgs, 'gpt-4');
    cache.get(msgs, 'gpt-4');
    const entry = cache.getByKey(buildKey(msgs, 'gpt-4'));
    expect(entry!.hitCount).toBe(2);
  });
});

describe('stats', () => {
  it('increments misses on cache miss', () => {
    const cache = createCache();
    cache.get(msgs, 'gpt-4');
    expect(cache.stats().misses).toBe(1);
    expect(cache.stats().hits).toBe(0);
  });

  it('increments hits on cache hit', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, response);
    cache.get(msgs, 'gpt-4');
    cache.get(msgs, 'gpt-4');
    expect(cache.stats().hits).toBe(2);
    expect(cache.stats().misses).toBe(0);
  });

  it('computes hitRate correctly', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, response);
    cache.get(msgs, 'gpt-4'); // hit
    cache.get([{ role: 'user', content: 'other' }], 'gpt-4'); // miss
    expect(cache.stats().hitRate).toBeCloseTo(0.5);
  });

  it('hitRate is 0 when no lookups', () => {
    const cache = createCache();
    expect(cache.stats().hitRate).toBe(0);
  });

  it('totalEntries reflects stored entries', () => {
    const cache = createCache();
    expect(cache.stats().totalEntries).toBe(0);
    cache.set(msgs, 'gpt-4', undefined, response);
    expect(cache.stats().totalEntries).toBe(1);
  });

  it('stats().totalEntries excludes expired entries', () => {
    vi.useFakeTimers();
    const cache = createCache({ eviction: { ttlMs: 100 } });
    const resp = { content: 'hi', model: 'gpt-4', usage: {} };
    cache.set([{ role: 'user' as const, content: 'test' }], 'gpt-4', undefined, resp);

    expect(cache.stats().totalEntries).toBe(1);

    vi.advanceTimersByTime(101);

    expect(cache.stats().totalEntries).toBe(0);
    vi.useRealTimers();
  });
});

describe('invalidate', () => {
  it('removes only entries for the specified model', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, { ...response, model: 'gpt-4' });
    cache.set(msgs, 'gpt-3.5-turbo', undefined, { ...response, model: 'gpt-3.5-turbo' });
    expect(cache.size).toBe(2);
    const removed = cache.invalidate('gpt-4');
    expect(removed).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get(msgs, 'gpt-4')).toBeNull();
    expect(cache.get(msgs, 'gpt-3.5-turbo')).not.toBeNull();
  });

  it('removes all entries when no model given', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, response);
    cache.set([{ role: 'user', content: 'other' }], 'gpt-4', undefined, response);
    const removed = cache.invalidate();
    expect(removed).toBe(2);
    expect(cache.size).toBe(0);
  });
});

describe('clear', () => {
  it('removes all entries and resets stats', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, response);
    cache.get(msgs, 'gpt-4');
    cache.clear();
    expect(cache.size).toBe(0);
    const s = cache.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
  });
});

describe('delete / has', () => {
  it('delete removes a specific entry by key', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, response);
    const key = buildKey(msgs, 'gpt-4');
    expect(cache.has(key)).toBe(true);
    expect(cache.delete(key)).toBe(true);
    expect(cache.has(key)).toBe(false);
  });

  it('delete returns false for unknown key', () => {
    const cache = createCache();
    expect(cache.delete('nonexistent')).toBe(false);
  });

  it('has() does not affect LRU eviction order', () => {
    const cache = createCache({ eviction: { maxEntries: 2 } });
    const msgs1 = [{ role: 'user' as const, content: 'first' }];
    const msgs2 = [{ role: 'user' as const, content: 'second' }];
    const resp = { content: 'hi', model: 'gpt-4', usage: {} };

    cache.set(msgs1, 'gpt-4', undefined, resp);
    cache.set(msgs2, 'gpt-4', undefined, resp);

    // has() should NOT move 'first' to MRU, so adding a third should evict 'first'
    cache.has(buildKey(msgs1, 'gpt-4'));

    const msgs3 = [{ role: 'user' as const, content: 'third' }];
    cache.set(msgs3, 'gpt-4', undefined, resp);

    // 'first' should have been evicted (LRU), not 'second'
    expect(cache.get(msgs1, 'gpt-4')).toBeNull();
    expect(cache.get(msgs2, 'gpt-4')).not.toBeNull();
  });
});

describe('LRU eviction', () => {
  it('evicts the LRU entry when maxEntries is exceeded', () => {
    const cache = createCache({ eviction: { maxEntries: 2 } });
    const m1: CacheableMessage[] = [{ role: 'user', content: 'msg1' }];
    const m2: CacheableMessage[] = [{ role: 'user', content: 'msg2' }];
    const m3: CacheableMessage[] = [{ role: 'user', content: 'msg3' }];
    cache.set(m1, 'gpt-4', undefined, response);
    cache.set(m2, 'gpt-4', undefined, response);
    // Access m1 so m2 becomes the LRU
    cache.get(m1, 'gpt-4');
    // Adding m3 should evict m2 (LRU)
    cache.set(m3, 'gpt-4', undefined, response);
    expect(cache.size).toBe(2);
    expect(cache.get(m2, 'gpt-4')).toBeNull();
    expect(cache.get(m1, 'gpt-4')).not.toBeNull();
    expect(cache.get(m3, 'gpt-4')).not.toBeNull();
  });
});

describe('TTL eviction', () => {
  it('returns null for an expired entry', async () => {
    vi.useFakeTimers();
    const cache = createCache({ eviction: { ttlMs: 100 } });
    cache.set(msgs, 'gpt-4', undefined, response);
    expect(cache.get(msgs, 'gpt-4')).not.toBeNull();
    vi.advanceTimersByTime(101);
    expect(cache.get(msgs, 'gpt-4')).toBeNull();
    vi.useRealTimers();
  });

  it('returns entry before TTL expires', async () => {
    vi.useFakeTimers();
    const cache = createCache({ eviction: { ttlMs: 500 } });
    cache.set(msgs, 'gpt-4', undefined, response);
    vi.advanceTimersByTime(499);
    expect(cache.get(msgs, 'gpt-4')).not.toBeNull();
    vi.useRealTimers();
  });
});

describe('serialize', () => {
  it('returns version 1 with entries and stats', () => {
    const cache = createCache();
    cache.set(msgs, 'gpt-4', undefined, response);
    cache.get(msgs, 'gpt-4');
    cache.get([{ role: 'user', content: 'other' }], 'gpt-4');
    const state = cache.serialize();
    expect(state.version).toBe(1);
    expect(state.entries.length).toBe(1);
    expect(state.stats.hits).toBe(1);
    expect(state.stats.misses).toBe(1);
  });
});

describe('size', () => {
  it('reflects the number of stored entries', () => {
    const cache = createCache();
    expect(cache.size).toBe(0);
    cache.set(msgs, 'gpt-4', undefined, response);
    expect(cache.size).toBe(1);
    cache.set([{ role: 'user', content: 'another' }], 'gpt-4', undefined, response);
    expect(cache.size).toBe(2);
  });
});

describe('wrap', () => {
  it('preserves this binding when calling create through the proxy', async () => {
    const cache = createCache();
    const completions = {
      _config: { baseURL: 'https://api.openai.com' },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      create: vi.fn(async function (this: typeof completions, _params: unknown) {
        // Simulate a real SDK method that relies on this context
        if (!this._config) {
          throw new Error('this context lost: _config is undefined');
        }
        return {
          choices: [{ message: { content: `Response from ${this._config.baseURL}` } }],
          model: 'gpt-4',
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      }),
    };
    const fakeClient = { chat: { completions } };
    const wrapped = cache.wrap(fakeClient);
    const params = { messages: msgs, model: 'gpt-4' };
    const result = await wrapped.chat.completions.create(params);
    expect(result).toBeDefined();
    expect(completions.create).toHaveBeenCalledTimes(1);
  });

  it('returns cached response on second call', async () => {
    const cache = createCache();
    const fakeCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Hello from API' } }],
      model: 'gpt-4',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const fakeClient = {
      chat: {
        completions: {
          create: fakeCreate,
        },
      },
    };
    const wrapped = cache.wrap(fakeClient);
    const params = { messages: msgs, model: 'gpt-4' };
    await wrapped.chat.completions.create(params);
    await wrapped.chat.completions.create(params);
    // API should only be called once; second call served from cache
    expect(fakeCreate).toHaveBeenCalledTimes(1);
  });
});
