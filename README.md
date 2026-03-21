# llm-response-cache

Prompt-hash-keyed LLM response cache with model-aware invalidation, O(1) LRU eviction, and TTL support. Zero runtime dependencies.

## Install

```bash
npm install llm-response-cache
```

## Quick Start

### createCache / get / set

```typescript
import { createCache } from 'llm-response-cache';

const cache = createCache({
  eviction: {
    maxEntries: 1000,   // evict LRU after this many entries
    ttlMs: 60_000,      // expire entries after 60 seconds (0 = no TTL)
  },
  pricePerMTokInput: 2.50,   // USD per million input tokens (default)
  pricePerMTokOutput: 10.00, // USD per million output tokens (default)
});

const messages = [{ role: 'user', content: 'What is 2+2?' }];
const model = 'gpt-4';

// Manual get/set
const hit = cache.get(messages, model);
if (!hit) {
  const response = await openai.chat.completions.create({ model, messages });
  cache.set(messages, model, { model }, {
    content: response.choices[0].message.content!,
    model: response.model,
    usage: {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    },
  });
}
```

### wrap — transparent caching proxy

```typescript
import OpenAI from 'openai';
import { createCache } from 'llm-response-cache';

const openai = new OpenAI();
const cache = createCache();
const cachedOpenAI = cache.wrap(openai);

// First call hits the API; second call is served from cache
const r1 = await cachedOpenAI.chat.completions.create({ model: 'gpt-4', messages });
const r2 = await cachedOpenAI.chat.completions.create({ model: 'gpt-4', messages });
```

### stats

```typescript
const s = cache.stats();
console.log(s.hitRate);           // 0–1
console.log(s.tokensSaved);       // cumulative tokens served from cache
console.log(s.estimatedCostSaved); // USD saved
```

### invalidate / clear / delete

```typescript
cache.invalidate('gpt-4');   // remove all gpt-4 entries
cache.invalidate();          // remove all entries
cache.delete(key);           // remove by exact cache key
cache.clear();               // remove everything and reset stats
```

### serialize

```typescript
const state = cache.serialize();
// { entries: CacheEntry[], stats: { hits, misses }, version: 1 }
```

## Cache key

Keys are SHA-256 digests of a canonical JSON object containing:
- Normalized messages (NFC, trimmed, lowercased role)
- Lowercased model name
- Output-affecting params only (`temperature`, `top_p`, `max_tokens`, `tools`, `tool_choice`, `response_format`, `stop`, `seed`, `system`, `top_k`)

Params that do not affect output (`stream`, `user`, `timeout`, etc.) are excluded from the key.

## API

| Method | Description |
|---|---|
| `get(messages, model, params?)` | Lookup; returns `CacheEntry` or `null` |
| `set(messages, model, params, response)` | Store a response |
| `wrap(client, options?)` | Proxy wrapping `client.chat.completions.create` |
| `stats()` | Returns `CacheStats` |
| `invalidate(model?)` | Remove entries (all, or by model) |
| `clear()` | Clear all entries and reset hit/miss counters |
| `delete(key)` | Remove entry by key |
| `has(key)` | Check if key exists |
| `getByKey(key)` | Retrieve entry by exact key |
| `buildKey(messages, model, params?)` | Compute the cache key without storing |
| `serialize()` | Export state as `CacheState` |
| `size` | Number of stored entries |
