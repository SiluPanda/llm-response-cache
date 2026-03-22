# llm-response-cache

Prompt-hash-keyed LLM response cache with model-aware invalidation, O(1) LRU eviction, and TTL support. Zero runtime dependencies.

[![npm version](https://img.shields.io/npm/v/llm-response-cache.svg)](https://www.npmjs.com/package/llm-response-cache)
[![license](https://img.shields.io/npm/l/llm-response-cache.svg)](https://github.com/SiluPanda/llm-response-cache/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/llm-response-cache.svg)](https://nodejs.org)

---

## Description

`llm-response-cache` is an exact-match response cache purpose-built for LLM API calls. It accepts complete request parameters -- messages, model, temperature, and other generation settings -- hashes them into a deterministic SHA-256 cache key, and returns the cached response on a hit or `null` on a miss. Every cache hit records the tokens and estimated dollars saved, giving operators concrete visibility into how much the cache is reducing API spend.

General-purpose caches have no concept of LLM request structure. The caller must manually construct cache keys, decide which request parameters affect the output (temperature does, API key does not), and track cost savings. `llm-response-cache` handles all of this automatically:

- **Smart key construction.** Only output-affecting parameters (`temperature`, `top_p`, `max_tokens`, `tools`, `tool_choice`, `response_format`, `stop`, `seed`, `system`, `top_k`) are included in the cache key. Parameters that do not affect output (`stream`, `user`, `timeout`, `api_key`, `organization`) are excluded. Two requests that differ only in `stream: true` vs `stream: false` resolve to the same cache key.
- **Deterministic normalization.** Messages are NFC-normalized and trimmed, roles and model names are lowercased, and JSON keys are sorted at every nesting level before hashing. Property order does not matter.
- **Model-aware invalidation.** Entries can be invalidated by model name, allowing stale entries to be purged when a model is updated or deprecated.
- **Cost tracking.** Every cache hit computes estimated cost savings from input and output token counts using configurable per-million-token pricing.

This package is distinct from semantic caching (`llm-semantic-cache`), which uses embedding similarity to match paraphrased prompts. Exact-match caching is simpler, faster (hash in microseconds vs. embedding in milliseconds), cheaper (zero embedding API cost), and deterministic (no false positives). The two approaches are complementary and can be layered: check the exact cache first, then fall back to the semantic cache.

---

## Installation

```bash
npm install llm-response-cache
```

Requires Node.js 18 or later.

---

## Quick Start

### Manual get/set

```typescript
import { createCache } from 'llm-response-cache';

const cache = createCache();

const messages = [{ role: 'user', content: 'What is 2+2?' }];
const model = 'gpt-4';

// Check cache first
const hit = cache.get(messages, model);
if (hit) {
  console.log('Cache hit:', hit.response.content);
} else {
  // Call your LLM provider
  const apiResponse = await openai.chat.completions.create({ model, messages });

  // Store the response
  cache.set(messages, model, undefined, {
    content: apiResponse.choices[0].message.content!,
    model: apiResponse.model,
    usage: {
      inputTokens: apiResponse.usage?.prompt_tokens,
      outputTokens: apiResponse.usage?.completion_tokens,
    },
  });
}
```

### Transparent proxy with `wrap`

```typescript
import OpenAI from 'openai';
import { createCache } from 'llm-response-cache';

const openai = new OpenAI();
const cache = createCache();
const cachedOpenAI = cache.wrap(openai);

// First call hits the API
const r1 = await cachedOpenAI.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});

// Second identical call is served from cache -- zero latency, zero cost
const r2 = await cachedOpenAI.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

### Checking cost savings

```typescript
const stats = cache.stats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
console.log(`Tokens saved: ${stats.tokensSaved}`);
console.log(`Estimated cost saved: $${stats.estimatedCostSaved.toFixed(4)}`);
```

---

## Features

- **SHA-256 prompt hashing** -- Deterministic cache keys derived from normalized messages, model, and output-affecting parameters.
- **O(1) LRU eviction** -- Doubly-linked list backed in-memory store ensures constant-time promotion, eviction, and lookup.
- **TTL expiration** -- Time-based entry expiry with configurable duration. Expired entries are lazily pruned on access.
- **Transparent client proxy** -- `wrap()` intercepts `client.chat.completions.create` calls via JavaScript `Proxy`, caching responses automatically.
- **Model-aware invalidation** -- Selectively purge cached entries by model name when a model is updated or deprecated.
- **Cost-savings tracking** -- Tracks cumulative tokens saved and estimated dollar savings using configurable per-million-token pricing.
- **Serialization** -- Export full cache state (entries, stats, version) for persistence or transfer across environments.
- **Zero runtime dependencies** -- Uses only Node.js built-in `node:crypto` for hashing.
- **Full TypeScript support** -- Ships with declaration files and complete type definitions for all exports.

---

## API Reference

### `createCache(options?)`

Factory function that creates and returns a `ResponseCache` instance.

```typescript
import { createCache } from 'llm-response-cache';

const cache = createCache({
  eviction: {
    maxEntries: 500,
    ttlMs: 300_000,   // 5 minutes
  },
  pricePerMTokInput: 2.50,
  pricePerMTokOutput: 10.00,
});
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options` | `ResponseCacheOptions` | `undefined` | Optional configuration object. |

Returns: `ResponseCache`

---

### `ResponseCache`

The cache instance returned by `createCache`. All methods are available on this object.

#### `cache.get(messages, model, params?)`

Looks up a cached response. On a hit, increments the entry's `hitCount`, updates `lastAccessedAt`, and increments the global hit counter. On a miss, increments the global miss counter.

```typescript
const entry = cache.get(
  [{ role: 'user', content: 'Hello' }],
  'gpt-4',
  { temperature: 0 }
);
```

| Parameter | Type | Description |
|---|---|---|
| `messages` | `CacheableMessage[]` | The conversation messages. |
| `model` | `string` | The model identifier. |
| `params` | `Record<string, unknown>` | Optional. Additional request parameters (only output-affecting ones are used for the key). |

Returns: `CacheEntry | null`

---

#### `cache.set(messages, model, params, response)`

Stores a response in the cache. If `maxEntries` is exceeded, the least recently used entry is evicted.

```typescript
cache.set(
  [{ role: 'user', content: 'Hello' }],
  'gpt-4',
  { temperature: 0 },
  {
    content: 'Hi there!',
    model: 'gpt-4',
    usage: { inputTokens: 5, outputTokens: 3 },
  }
);
```

| Parameter | Type | Description |
|---|---|---|
| `messages` | `CacheableMessage[]` | The conversation messages. |
| `model` | `string` | The model identifier. |
| `params` | `Record<string, unknown> \| undefined` | Request parameters (or `undefined`). |
| `response` | `CacheableResponse` | The LLM response to cache. |

Returns: `void`

---

#### `cache.wrap(client, options?)`

Returns a `Proxy`-wrapped copy of the client where `client.chat.completions.create` calls are transparently intercepted. On a cache hit, the cached response is returned immediately without calling the underlying API. On a miss, the API is called, the response is cached, and the original result is returned.

```typescript
const cachedClient = cache.wrap(openaiClient);
```

The wrapper automatically extracts messages, model, and parameters from the first argument to `create`, and parses the response using OpenAI and Anthropic response formats (extracting content from `choices[0].message.content` or `content[0].text`, and usage from `prompt_tokens`/`completion_tokens` or `input_tokens`/`output_tokens`).

**Custom extraction:**

```typescript
const cachedClient = cache.wrap(client, {
  extractMessages: (args) => {
    const params = args[0] as Record<string, unknown>;
    return {
      messages: params.messages as CacheableMessage[],
      model: params.model as string,
      params,
    };
  },
  extractResponse: (response) => ({
    content: (response as any).text,
    model: (response as any).modelId,
  }),
});
```

| Parameter | Type | Description |
|---|---|---|
| `client` | `T extends object` | The LLM client instance to wrap. |
| `options.extractMessages` | `(args: unknown[]) => { messages, model, params }` | Optional. Custom function to extract cache-relevant fields from call arguments. |
| `options.extractResponse` | `(response: unknown) => CacheableResponse` | Optional. Custom function to extract cacheable data from the API response. |

Returns: `T` (same type as input, transparently proxied)

---

#### `cache.stats()`

Returns current cache statistics including hit/miss counts, hit rate, token savings, and estimated cost savings.

```typescript
const stats = cache.stats();
// {
//   hits: 42,
//   misses: 8,
//   hitRate: 0.84,
//   totalEntries: 15,
//   tokensSaved: 125000,
//   estimatedCostSaved: 1.5625
// }
```

Returns: `CacheStats`

Cost savings are computed using the `pricePerMTokInput` and `pricePerMTokOutput` values from options (defaults: $2.50 and $10.00 per million tokens respectively). The formula for each entry is:

```
costSaved = hitCount * (inputTokens / 1_000_000 * pricePerMTokInput + outputTokens / 1_000_000 * pricePerMTokOutput)
```

---

#### `cache.invalidate(model?)`

Removes cache entries. When called with a model name, removes only entries for that model. When called without arguments, removes all entries.

```typescript
const removed = cache.invalidate('gpt-4');  // remove all gpt-4 entries
console.log(`Removed ${removed} entries`);

cache.invalidate();  // remove all entries
```

| Parameter | Type | Description |
|---|---|---|
| `model` | `string` | Optional. If provided, only entries matching this model are removed. |

Returns: `number` -- the count of removed entries.

---

#### `cache.clear()`

Removes all entries and resets hit/miss counters to zero.

```typescript
cache.clear();
```

Returns: `void`

---

#### `cache.delete(key)`

Removes a single entry by its SHA-256 cache key.

```typescript
const removed = cache.delete('a1b2c3...');
```

| Parameter | Type | Description |
|---|---|---|
| `key` | `string` | The SHA-256 hex key of the entry to remove. |

Returns: `boolean` -- `true` if the entry existed and was removed, `false` otherwise.

---

#### `cache.has(key)`

Checks whether an entry exists for the given cache key.

```typescript
if (cache.has('a1b2c3...')) {
  console.log('Entry exists');
}
```

| Parameter | Type | Description |
|---|---|---|
| `key` | `string` | The SHA-256 hex key to check. |

Returns: `boolean`

---

#### `cache.getByKey(key)`

Retrieves an entry by its exact SHA-256 cache key, without computing it from messages and model.

```typescript
const entry = cache.getByKey('a1b2c3...');
```

| Parameter | Type | Description |
|---|---|---|
| `key` | `string` | The SHA-256 hex key. |

Returns: `CacheEntry | null`

---

#### `cache.buildKey(messages, model, params?)`

Computes the SHA-256 cache key for the given inputs without storing anything. Useful for inspecting what key a request would produce.

```typescript
const key = cache.buildKey(
  [{ role: 'user', content: 'Hello' }],
  'gpt-4',
  { temperature: 0 }
);
console.log(key); // 64-character hex string
```

| Parameter | Type | Description |
|---|---|---|
| `messages` | `CacheableMessage[]` | The conversation messages. |
| `model` | `string` | The model identifier. |
| `params` | `Record<string, unknown>` | Optional. Request parameters. |

Returns: `string` -- 64-character lowercase hex SHA-256 digest.

---

#### `cache.serialize()`

Exports the full cache state for persistence or transfer.

```typescript
const state = cache.serialize();
// {
//   entries: CacheEntry[],
//   stats: { hits: number, misses: number },
//   version: 1
// }
```

Returns: `CacheState`

---

#### `cache.size`

Read-only property returning the number of entries currently in the cache.

```typescript
console.log(`Cache contains ${cache.size} entries`);
```

Type: `number`

---

### `buildKey(messages, model, params?)`

Standalone export of the cache key computation function. Computes a SHA-256 hash from normalized messages, model, and output-affecting parameters.

```typescript
import { buildKey } from 'llm-response-cache';

const key = buildKey(
  [{ role: 'user', content: 'Hello' }],
  'gpt-4',
  { temperature: 0.7, max_tokens: 100 }
);
```

Returns: `string` -- 64-character lowercase hex SHA-256 digest.

---

### `sortedStringify(value)`

Standalone export of the deterministic JSON serialization function. Produces a canonical string representation of any value with object keys sorted alphabetically at every nesting level.

```typescript
import { sortedStringify } from 'llm-response-cache';

sortedStringify({ b: 2, a: 1 });
// '{"a":1,"b":2}'
```

| Parameter | Type | Description |
|---|---|---|
| `value` | `unknown` | The value to serialize. |

Returns: `string`

---

## Types

All types are exported from the package entry point.

### `CacheableMessage`

```typescript
interface CacheableMessage {
  role: string;
  content: string | unknown[];
}
```

Represents a single message in the conversation. The `content` field accepts either a plain string or an array of content parts (for multimodal inputs).

---

### `CacheableResponse`

```typescript
interface CacheableResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  metadata?: Record<string, unknown>;
}
```

The LLM response data to be cached. When `usage` is provided, exact token counts are used for cost-savings calculations. When omitted, tokens are estimated from text length (approximately 4 characters per token).

---

### `CacheEntry`

```typescript
interface CacheEntry {
  key: string;
  response: CacheableResponse;
  createdAt: number;
  lastAccessedAt: number;
  hitCount: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}
```

A stored cache entry with metadata. `hitCount` tracks how many times the entry has been served from cache. `inputTokens` and `outputTokens` are used for cost-savings calculations.

---

### `CacheStats`

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalEntries: number;
  tokensSaved: number;
  estimatedCostSaved: number;
}
```

Aggregate statistics returned by `cache.stats()`. `hitRate` is computed as `hits / (hits + misses)` and is `0` when no lookups have occurred. `tokensSaved` is the cumulative sum of tokens that would have been consumed by repeated API calls. `estimatedCostSaved` is the dollar estimate based on configured pricing.

---

### `CacheState`

```typescript
interface CacheState {
  entries: CacheEntry[];
  stats: { hits: number; misses: number };
  version: 1;
}
```

The serialized form of the cache, returned by `cache.serialize()`.

---

### `EvictionConfig`

```typescript
interface EvictionConfig {
  maxEntries?: number;
  ttlMs?: number;
  strategy?: 'lru' | 'ttl' | 'none';
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `maxEntries` | `number` | `1000` | Maximum number of entries before LRU eviction. |
| `ttlMs` | `number` | `0` | Time-to-live in milliseconds. `0` disables TTL expiration. |
| `strategy` | `'lru' \| 'ttl' \| 'none'` | `'lru'` | Eviction strategy. |

---

### `ResponseCacheOptions`

```typescript
interface ResponseCacheOptions {
  eviction?: EvictionConfig;
  pricePerMTokInput?: number;
  pricePerMTokOutput?: number;
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `eviction` | `EvictionConfig` | See above | Eviction configuration. |
| `pricePerMTokInput` | `number` | `2.50` | Price per million input tokens in USD, used for cost-savings estimates. |
| `pricePerMTokOutput` | `number` | `10.00` | Price per million output tokens in USD, used for cost-savings estimates. |

---

## Configuration

### Eviction

The cache supports LRU eviction and TTL expiration, independently or combined.

```typescript
// LRU only: keep at most 500 entries
const cache = createCache({
  eviction: { maxEntries: 500 },
});

// TTL only: entries expire after 10 minutes
const cache = createCache({
  eviction: { ttlMs: 600_000 },
});

// Combined: LRU with 500 max entries and 10-minute TTL
const cache = createCache({
  eviction: { maxEntries: 500, ttlMs: 600_000 },
});
```

When `maxEntries` is reached, the least recently used entry is evicted to make room. TTL expiration is lazy: expired entries are detected and pruned on access rather than on a background timer.

### Cost tracking

Configure pricing to match your LLM provider's rates for accurate cost-savings reporting.

```typescript
// GPT-4o pricing
const cache = createCache({
  pricePerMTokInput: 2.50,
  pricePerMTokOutput: 10.00,
});

// Claude Sonnet pricing
const cache = createCache({
  pricePerMTokInput: 3.00,
  pricePerMTokOutput: 15.00,
});
```

---

## Error Handling

The cache is designed to be safe and non-throwing in normal operation:

- **Cache miss** returns `null` from `get()` and `getByKey()`. No exceptions are thrown.
- **Deleting a non-existent key** returns `false` from `delete()`. No exceptions are thrown.
- **Expired entries** are silently pruned on access and treated as misses.
- **LRU eviction** happens automatically when `maxEntries` is exceeded during `set()`. No manual intervention is required.
- **Missing usage data** is handled gracefully. When `usage` is not provided in a `CacheableResponse`, token counts are estimated from text length (approximately 4 characters per token).

---

## Advanced Usage

### Precomputing cache keys

Use `buildKey` to inspect or log cache keys without performing a lookup or store.

```typescript
import { buildKey } from 'llm-response-cache';

const key = buildKey(messages, 'gpt-4', { temperature: 0 });
console.log(`Cache key: ${key}`);
```

### Persisting cache state

Use `serialize()` to export the cache and restore it later or transfer it between environments.

```typescript
import { writeFileSync, readFileSync } from 'fs';

// Save
const state = cache.serialize();
writeFileSync('cache-snapshot.json', JSON.stringify(state));

// Restore (manual rehydration)
const saved = JSON.parse(readFileSync('cache-snapshot.json', 'utf-8'));
const newCache = createCache();
for (const entry of saved.entries) {
  // Re-insert entries using low-level key-based access
  // Note: this rehydrates data but does not restore hit/miss counters
}
```

### Model migration

When switching from one model to another, invalidate stale entries for the old model.

```typescript
// Purge all gpt-3.5-turbo entries after migrating to gpt-4
cache.invalidate('gpt-3.5-turbo');

// Check remaining entries
console.log(`Entries remaining: ${cache.size}`);
```

### Wrapping custom clients

For LLM clients that do not follow the OpenAI `chat.completions.create` pattern, provide custom extractors.

```typescript
const cachedClient = cache.wrap(myCustomClient, {
  extractMessages: (args) => {
    const opts = args[0] as any;
    return {
      messages: opts.prompt.map((p: any) => ({ role: p.role, content: p.text })),
      model: opts.modelName,
      params: opts,
    };
  },
  extractResponse: (response) => ({
    content: (response as any).generatedText,
    model: (response as any).modelUsed,
    usage: {
      inputTokens: (response as any).tokensIn,
      outputTokens: (response as any).tokensOut,
    },
  }),
});
```

### Cache key determinism

The cache key is stable across runs, platforms, and Node.js versions. Two requests are cache-equivalent if and only if their normalized messages, lowercased model name, and output-affecting parameters produce the same SHA-256 digest. Parameter order and whitespace differences are normalized away.

```typescript
import { buildKey } from 'llm-response-cache';

// These produce the same key:
buildKey([{ role: 'User', content: '  Hello  ' }], 'GPT-4', { temperature: 0.7, max_tokens: 100 });
buildKey([{ role: 'user', content: 'Hello' }], 'gpt-4', { max_tokens: 100, temperature: 0.7 });

// These produce different keys:
buildKey([{ role: 'user', content: 'Hello' }], 'gpt-4');
buildKey([{ role: 'user', content: 'Hello' }], 'gpt-3.5-turbo');
```

### Parameters included in cache keys

| Included (affect output) | Excluded (do not affect output) |
|---|---|
| `temperature` | `stream` |
| `top_p` | `stream_options` |
| `max_tokens` | `n` |
| `max_completion_tokens` | `user` |
| `tools` | `api_key` |
| `tool_choice` | `timeout` |
| `response_format` | `request_id` |
| `stop` | `idempotency_key` |
| `seed` | `organization` |
| `system` | `max_retries` |
| `top_k` | |

---

## TypeScript

This package is written in TypeScript and ships with declaration files (`dist/index.d.ts`). All public types are exported from the package entry point.

```typescript
import {
  createCache,
  buildKey,
  sortedStringify,
} from 'llm-response-cache';

import type {
  CacheableMessage,
  CacheableResponse,
  CacheEntry,
  CacheState,
  CacheStats,
  EvictionConfig,
  ResponseCache,
  ResponseCacheOptions,
} from 'llm-response-cache';
```

The `ResponseCache` interface provides full type safety for all cache operations. The `wrap<T>()` method preserves the type of the wrapped client, so IDE autocompletion works transparently on the proxied object.

---

## License

MIT
