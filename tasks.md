# llm-response-cache — Task Breakdown

This file tracks all implementation tasks derived from SPEC.md. Tasks are grouped by phase and ordered by dependency.

---

## Phase 1: Project Scaffolding and Type Definitions

- [ ] **Install dev dependencies** — Add `typescript`, `vitest`, `eslint`, and `@types/better-sqlite3` to devDependencies in package.json. Add `better-sqlite3` and `ioredis` as optional peerDependencies with `peerDependenciesMeta` marking them as optional. | Status: not_done

- [ ] **Configure package.json fields** — Add `"bin": { "llm-response-cache": "dist/cli.js" }` to package.json for CLI support. Verify `"main"`, `"types"`, `"files"`, and `"engines"` fields are correct. Ensure `"prepublishOnly": "npm run build"` is present in scripts. | Status: not_done

- [ ] **Define all TypeScript types** — Create `src/types.ts` with all type definitions: `ResponseCacheOptions`, `CacheEntry`, `CacheHit`, `CacheStats`, `CacheableResponse`, `RequestParams`, `MessageInput` (supporting OpenAI-style message arrays and Anthropic-style objects), `StorageBackend` interface (with `get`, `set`, `delete`, `clear`, `query`, `update`, `size`, `sizeByModel`, optional `flush`, optional `close`), `WrapOptions` (with `streamReplay`, `streamReplaySpeed`, `clientType`, `extractParams`, `buildResponse`), `ModelPrice` type, and eviction policy types. | Status: not_done

- [ ] **Set up public API exports** — Update `src/index.ts` to export `createCache`, the `ResponseCache` class (for `deserialize` static method access), and all public types from `types.ts`. | Status: not_done

---

## Phase 2: Cache Key Construction and Normalization

- [ ] **Implement message normalization** — Create `src/normalize.ts` with functions to normalize message content: apply Unicode NFC normalization to `content` fields, trim leading/trailing whitespace from `content` fields, preserve `role` fields exactly, preserve message order, handle multi-part content arrays (normalize text parts individually, include image parts by URL or content hash). Support both OpenAI-style message arrays and Anthropic-style objects with `system` field. | Status: not_done

- [ ] **Implement parameter normalization** — In `src/normalize.ts`, add functions to normalize request parameters: convert model name to lowercase, normalize numeric parameters (`temperature`, `top_p`, `max_tokens`, `frequency_penalty`, `presence_penalty`, `seed`) to canonical numeric representations (e.g., `0` and `0.0` produce the same value), remove `undefined`/`null` fields, strip output-irrelevant parameters (`stream`, `stream_options`, `n`, `user`, `api_key`, `timeout`, `request_id`, `idempotency_key`, `organization`). | Status: not_done

- [ ] **Implement canonicalization** — In `src/normalize.ts`, add a `canonicalize(messages, model, params)` function that extracts output-affecting parameters, applies all normalization steps, and serializes the result as JSON with keys sorted alphabetically at every level of nesting. Ensure deterministic output regardless of input property order. | Status: not_done

- [ ] **Implement optional prompt normalizer hook** — In `src/normalize.ts`, support an optional `normalizer` function (e.g., from `prompt-dedup`) that is applied to message content before canonicalization. This increases exact-match hit rates for prompts differing only in formatting. | Status: not_done

- [ ] **Implement cache key hashing** — Create `src/key.ts` with a `computeCacheKey(messages, model, params, normalizer?)` function that calls `canonicalize()` on the inputs and then computes `SHA-256` using `node:crypto`. Return the hash as a lowercase hex string (64 characters). | Status: not_done

- [ ] **Write normalize.test.ts** — Create `src/__tests__/normalize.test.ts`. Test cases: JSON key sorting at multiple nesting levels, whitespace trimming in message content, Unicode NFC normalization (composed vs decomposed sequences produce same output), handling of `undefined`/`null` parameters (treated as absent), numeric normalization (`0` vs `0.0`), model name lowercase conversion, multi-part content normalization, Anthropic-style message format normalization, excluded parameters are stripped (`stream`, `user`, `api_key`, etc.), `temperature: undefined` and omitted `temperature` produce the same canonical form, `temperature: 1` and omitted `temperature` produce different canonical forms. | Status: not_done

- [ ] **Write key.test.ts** — Create `src/__tests__/key.test.ts`. Test cases: identical requests produce the same key, requests differing in any output-affecting parameter produce different keys, requests differing only in non-output-affecting parameters (`stream`, `user`, `api_key`) produce the same key, key is a 64-character lowercase hex string, determinism across repeated calls, different property order produces the same key (`{ model: "gpt-4o", temperature: 0 }` and `{ temperature: 0, model: "gpt-4o" }` match), known input-output SHA-256 pairs for verification. | Status: not_done

---

## Phase 3: In-Memory Storage Backend

- [ ] **Define StorageBackend interface** — Create `src/storage/backend.ts` exporting the `StorageBackend` interface with methods: `get(key)`, `set(entry)`, `delete(key)`, `clear(options?)`, `query(filter)` (for model-version invalidation queries), `update(filter, update)` (for soft invalidation), `size()`, `sizeByModel()`, optional `flush()`, optional `close()`. | Status: not_done

- [ ] **Implement in-memory storage backend** — Create `src/storage/memory.ts` implementing `StorageBackend`. Use a `Map<string, CacheEntry>` for entry storage. Implement all interface methods. `query` and `update` iterate over the map and filter/update matching entries by model, modelVersion, and stale flag. | Status: not_done

- [ ] **Implement LRU doubly-linked list in memory backend** — Add a doubly-linked list to the in-memory backend for LRU eviction ordering. On `get` (cache hit), promote the entry to the head of the list. On eviction (when `maxEntries` is reached during `set`), remove from the tail. Achieve O(1) for promotion, eviction, and removal. | Status: not_done

- [ ] **Implement storage factory** — Create a factory function in `src/storage/` that takes the `storage` option from `ResponseCacheOptions` and returns the appropriate `StorageBackend` instance. Handle: string `'memory'`, object `{ type: 'memory' }`, object `{ type: 'sqlite', ... }`, object `{ type: 'filesystem', ... }`, object `{ type: 'redis', ... }`, and custom `StorageBackend` instances passed directly. | Status: not_done

- [ ] **Write memory storage tests** — Create storage tests in `src/__tests__/storage.test.ts`. Test cases: set and get entry by key, get returns undefined for missing key, delete entry returns true for existing/false for missing, clear removes all entries, clear with model filter removes only matching entries, query by model returns correct entries, query by modelVersion returns correct entries, query by stale flag works, update matching entries returns correct count, size returns total entry count, sizeByModel returns correct per-model counts, LRU eviction removes least recently accessed entry when maxEntries is reached, get promotes entry in LRU order. | Status: not_done

---

## Phase 4: Eviction Policies

- [ ] **Implement TTL eviction logic** — Create `src/eviction.ts` with TTL checking. On cache get, check if `entry.createdAt + (entry.ttl ?? globalTtl) < Date.now()`. If expired, treat as a miss and schedule the entry for deletion. Support per-entry TTL (via `cache.set` options) overriding the global TTL. | Status: not_done

- [ ] **Implement LRU eviction logic** — In `src/eviction.ts`, add LRU eviction logic. When a new entry is added and `maxEntries` is reached, identify and remove the least recently accessed entry. Integrate with the in-memory backend's doubly-linked list for O(1) eviction. For other backends, delegate eviction via backend-specific queries (e.g., SQLite `DELETE ... ORDER BY accessed_at ASC LIMIT ?`). | Status: not_done

- [ ] **Implement model-version-based eviction priority** — In `src/eviction.ts`, add logic so that entries flagged as stale (from superseded model versions) are evicted preferentially before non-stale entries when space is needed. This works with `invalidationStrategy: 'soft'`. | Status: not_done

- [ ] **Implement combined eviction policies** — Ensure TTL, LRU/maxEntries, and model-version-based eviction can be combined. An entry is evicted if any condition is met: TTL expired, LRU eviction triggered by size limit, or flagged as stale with model-version priority. | Status: not_done

- [ ] **Write eviction.test.ts** — Create `src/__tests__/eviction.test.ts`. Test cases: TTL expiry causes cache miss after duration, per-entry TTL overrides global TTL, LRU eviction removes least recently accessed when maxEntries reached, accessing an entry updates its `accessedAt` for LRU ordering, combined TTL+LRU works correctly, stale entries are evicted before non-stale entries when space is needed, TTL boundary condition (exactly at expiry time), entry with no TTL and no global TTL never expires. | Status: not_done

---

## Phase 5: Core Cache Logic

- [ ] **Implement ResponseCache class** — Create `src/cache.ts` with the `ResponseCache` class. Constructor accepts `ResponseCacheOptions`, validates options, initializes storage backend via factory, sets defaults (maxEntries: Infinity, evictionPolicy: 'lru', storage: 'memory', invalidationStrategy: 'auto'). Store model prices (built-in defaults merged with user-provided), token estimator (default: `Math.ceil(text.length / 4)`), and optional normalizer. | Status: not_done

- [ ] **Implement `cache.get(messages, model, params?)`** — In `cache.ts`, implement the `get` method: compute cache key via `computeCacheKey`, look up entry in storage backend, check TTL expiry (return null and delete if expired), check stale flag (if `invalidationStrategy: 'auto'` and entry is stale, return null; if `'soft'`, return with stale info; if `'manual'`, return normally), update `accessedAt` and `hitCount`, increment hit counter in stats, compute cost saved for this hit, return `CacheHit` object. Return `null` on miss (increment miss counter). | Status: not_done

- [ ] **Implement `cache.set(messages, model, params, response, options?)`** — In `cache.ts`, implement the `set` method: compute cache key, construct `CacheEntry` with key, messages, model, resolvedModel, modelVersion, params, responseText, usage, finishReason, timestamps, TTL (per-entry or global), stale=false, metadata. Trigger model version tracking (check if resolvedModel differs from last known version, handle version change per invalidation strategy). Trigger eviction if maxEntries reached. Store entry in backend. Return the cache key string. | Status: not_done

- [ ] **Implement `cache.delete(key)`** — In `cache.ts`, implement deletion of a specific cache entry by its SHA-256 key. Return true if the entry existed and was deleted, false otherwise. | Status: not_done

- [ ] **Implement `cache.clear(options?)`** — In `cache.ts`, implement clearing all cache entries, optionally filtered by model name. Delegate to the storage backend's `clear` method. | Status: not_done

- [ ] **Implement `cache.has(messages, model, params?)`** — In `cache.ts`, implement existence check: compute cache key, check if entry exists in storage without updating access statistics (no `accessedAt` update, no hit/miss counting). Return boolean. | Status: not_done

- [ ] **Implement `cache.invalidate(model?)`** — In `cache.ts`, implement manual invalidation. When called with a model name, delete all entries for that model. When called without arguments, delete all entries. Return the count of invalidated entries. Use storage backend's `query` and `delete` methods. | Status: not_done

- [ ] **Implement `createCache` factory function** — In `cache.ts` or `index.ts`, implement the `createCache(options?)` factory that constructs and returns a `ResponseCache` instance with the provided options. | Status: not_done

- [ ] **Implement built-in model prices** — In `cache.ts` or a separate `prices.ts`, define the built-in default model prices: `gpt-4o` (2.50/10.00), `gpt-4o-mini` (0.15/0.60), `gpt-4-turbo` (10.00/30.00), `gpt-3.5-turbo` (0.50/1.50), `claude-sonnet-4-20250514` (3.00/15.00), `claude-3-5-sonnet-20241022` (3.00/15.00), `claude-3-haiku-20240307` (0.25/1.25). Use as fallback when user does not provide `modelPrices`. Default fallback for unknown models: `{ input: 1.00, output: 2.00 }` per million tokens. | Status: not_done

- [ ] **Write cache.test.ts** — Create `src/__tests__/cache.test.ts`. Test cases: create cache with default options, `set` stores entry and returns cache key, `get` returns cached response on hit, `get` returns null on miss, `get` increments hit counter and `get`-miss increments miss counter, `delete` removes entry, `clear` removes all entries, `clear` with model filter, `has` returns true/false without updating stats, `invalidate` with model removes only that model's entries, `invalidate` without model removes all entries and returns count, TTL expiry causes `get` to return null, LRU eviction removes least recently used entry, identical requests produce cache hits, different temperature/model/max_tokens produce cache misses. | Status: not_done

---

## Phase 6: Model Version Tracking and Invalidation

- [ ] **Implement model version detection from response metadata** — Create `src/version.ts` with logic to extract the resolved model version from LLM API response metadata. For OpenAI, extract from the response's `model` field (e.g., request specifies `gpt-4o`, response reports `gpt-4o-2024-08-06`). Store both the requested model alias and the resolved version. | Status: not_done

- [ ] **Implement model version detection from name patterns** — In `src/version.ts`, add logic to extract version/date from model name patterns. Detect embedded dates in model names like `gpt-4o-2024-08-06` and `claude-3-5-sonnet-20241022`. Parse the date component as a version identifier. | Status: not_done

- [ ] **Implement model version registry** — In `src/version.ts`, implement a `ModelVersionRegistry` that maintains a mapping from model aliases to their most recently observed resolved versions (e.g., `{ "gpt-4o": "gpt-4o-2024-11-20" }`). Provide methods to update the registry and detect version changes. | Status: not_done

- [ ] **Implement `auto` invalidation strategy** — In `src/version.ts` or `cache.ts`, implement the `auto` strategy: when a version change is detected for a model alias, immediately delete all cache entries for that alias that were cached under the old version. Use storage backend's `query` and `delete` methods. | Status: not_done

- [ ] **Implement `soft` invalidation strategy** — Implement the `soft` strategy: when a version change is detected, flag all entries for the affected model alias from the old version as stale (`stale: true`, `staleReason: "Model version changed from X to Y"`). Stale entries are still served on cache hits but include the stale flag and reason. Use storage backend's `update` method. | Status: not_done

- [ ] **Implement `manual` invalidation strategy** — Implement the `manual` strategy: version tracking is recorded in the registry but no automatic invalidation occurs. Cache serves entries regardless of version changes. Caller must explicitly call `cache.invalidate(model)`. | Status: not_done

- [ ] **Integrate version tracking into cache.set** — When `cache.set` is called with a `resolvedModel`, check the version registry. If the resolved version differs from the last known version for that model alias, trigger the configured invalidation strategy. Update the registry with the new version. | Status: not_done

- [ ] **Handle dated model names in version tracking** — When the caller specifies a dated model name directly (e.g., `gpt-4o-2024-08-06`), treat the model name as the version. Do not trigger invalidation when different explicit versions coexist — they occupy separate key spaces. Only trigger invalidation for alias-based version changes. | Status: not_done

- [ ] **Write version.test.ts** — Create `src/__tests__/version.test.ts`. Test cases: extract version from OpenAI response model field, extract date from model name pattern `gpt-4o-2024-08-06`, extract date from `claude-3-5-sonnet-20241022` format, version registry updates on new version, version registry detects change from old version to new, `auto` strategy deletes old-version entries on version change, `soft` strategy flags old entries as stale with reason string, `manual` strategy records version but takes no action, stale entries served with `stale: true` and `staleReason` under soft strategy, dated model names do not trigger cross-version invalidation, first observation of a model version initializes the registry without triggering invalidation. | Status: not_done

---

## Phase 7: Cost-Savings Tracking and Statistics

- [ ] **Implement stats tracking** — Create `src/stats.ts` with a `StatsTracker` class that maintains running counters: `hits`, `misses`, `tokensSaved`, `costSaved`. Provide methods to `recordHit(tokensSaved, costSaved)`, `recordMiss()`, and `reset()`. | Status: not_done

- [ ] **Implement per-hit cost computation** — In `src/stats.ts`, implement cost computation for each cache hit: `inputTokens` from cached `usage.prompt_tokens` or estimated via `tokenEstimator(requestMessages)`, `outputTokens` from cached `usage.completion_tokens` or estimated via `tokenEstimator(responseText)`. Cost formula: `(inputTokens / 1_000_000 * inputPrice) + (outputTokens / 1_000_000 * outputPrice)`. Look up model price from configured `modelPrices`, built-in defaults, or fallback `{ input: 1.00, output: 2.00 }`. | Status: not_done

- [ ] **Implement token estimation** — In `src/stats.ts` or `cache.ts`, implement the default token estimator: `Math.ceil(text.length / 4)` (1 token per 4 characters heuristic). Support custom `tokenEstimator` function via config. For message arrays, serialize to text before estimating. | Status: not_done

- [ ] **Implement `cache.stats(options?)`** — In `cache.ts`, implement the `stats` method returning `CacheStats`: `hits`, `misses`, `hitRate` (hits / (hits + misses), 0 if no lookups), `entries` (total count from backend), `tokensSaved`, `costSaved`, `entriesByModel` (from backend's `sizeByModel`), `modelVersions` (from version registry), `staleEntries` (count of stale entries from backend query). Support optional `model` filter to return model-specific stats. | Status: not_done

- [ ] **Implement `cache.resetStats()`** — In `cache.ts`, implement resetting hit/miss/cost counters to zero without clearing cache entries. Useful for periodic reporting (e.g., daily stats). | Status: not_done

- [ ] **Write stats.test.ts** — Create `src/__tests__/stats.test.ts`. Test cases: initial stats are all zeros, hit increments hit counter and updates tokensSaved/costSaved, miss increments miss counter, hitRate computed correctly, resetStats zeros all counters without clearing entries, per-hit cost computation with known token counts and model prices, cost computation with estimated tokens (character-based), cost computation with exact usage from API response, unknown model falls back to default pricing, model-filtered stats return correct subset, entriesByModel reflects actual entries, staleEntries counts correctly. | Status: not_done

---

## Phase 8: Cache-Through Wrapper

- [ ] **Implement Proxy-based wrapper** — Create `src/wrapper/wrap.ts` with the `wrap<T>(client: T, options?: WrapOptions): T` method. Use JavaScript `Proxy` to intercept method calls on the client object. Detect client type automatically (OpenAI by presence of `client.chat.completions.create`, Anthropic by `client.messages.create`) or use `clientType` from `WrapOptions`. Support custom clients via `extractParams` and `buildResponse` functions. | Status: not_done

- [ ] **Implement OpenAI client adapter** — Create `src/wrapper/openai.ts` with functions to: extract cacheable parameters from an OpenAI `chat.completions.create` call (messages, model, temperature, top_p, max_tokens, etc., excluding stream/user/n), reconstruct an OpenAI-format response object from a `CacheHit` (with `id: 'cache-<hash>'`, `object: 'chat.completion'`, `choices`, `usage` zeroed, `_cached: true`, `_cacheKey`, `_cachedAt`), and extract the resolved model version from an OpenAI response's `model` field. | Status: not_done

- [ ] **Implement Anthropic client adapter** — Create `src/wrapper/anthropic.ts` with functions to: extract cacheable parameters from an Anthropic `messages.create` call, reconstruct an Anthropic-format response object from a `CacheHit` (with `id: 'cache-<hash>'`, `type: 'message'`, `role: 'assistant'`, `content: [{ type: 'text', text }]`, `usage` zeroed, `stop_reason`, `_cached: true`), and extract model version from Anthropic response metadata. | Status: not_done

- [ ] **Implement wrapper cache-hit flow** — In `wrap.ts`, on intercepted call: extract params, compute cache key, check cache. On hit: construct response object via adapter's `buildResponse`, record hit stats, return cached response immediately. | Status: not_done

- [ ] **Implement wrapper cache-miss flow** — In `wrap.ts`, on cache miss: delegate to the original client method, extract resolved model version from the response, extract response text and usage from the response, call `cache.set` with the response data, record miss stats, return the original response to the caller. | Status: not_done

- [ ] **Implement streaming cache miss handling** — Create `src/wrapper/stream.ts`. On a cache miss with `stream: true`: delegate to the original client with `stream: true`, return an async iterable to the caller that yields chunks as they arrive from the LLM, internally buffer the full response content as chunks arrive, on stream completion assemble the full response and cache it. If the stream is interrupted before completion, do not cache anything. | Status: not_done

- [ ] **Implement streaming cache hit replay** — In `src/wrapper/stream.ts`, on a cache hit with `stream: true`: return an async iterable that yields the cached response as synthetic chunks. Implement three replay modes: `immediate` (full response as a single chunk, sub-1ms), `simulated` (split into token-sized chunks with small delays to simulate generation speed), `throttled` (emit at configurable tokens-per-second rate, default 50 tps). | Status: not_done

- [ ] **Write wrapper.test.ts** — Create `src/__tests__/wrapper.test.ts`. Test cases: wrap mock OpenAI client — first call goes to client (miss), second identical call returns from cache (hit) with `_cached: true`, wrap mock Anthropic client — same behavior, changing temperature/model/max_tokens on second call produces a miss, non-output-affecting params (`stream: false` vs absent) do not affect cache key, response format matches original client format (OpenAI structure, Anthropic structure), model version extracted from response on miss, custom client with `extractParams`/`buildResponse` works correctly. | Status: not_done

- [ ] **Write stream.test.ts** — Create `src/__tests__/stream.test.ts`. Test cases: streaming miss buffers and caches complete response, streaming miss forwards chunks to caller in real time, interrupted stream does not cache, streaming hit replays cached response as async iterable, `immediate` mode emits full response as single chunk, `simulated` mode emits multiple chunks with delays, `throttled` mode respects tokens-per-second rate, stream replay includes correct completion signal. | Status: not_done

---

## Phase 9: Persistent Storage Backends

- [ ] **Implement filesystem storage backend** — Create `src/storage/filesystem.ts` implementing `StorageBackend`. On initialization, load the full JSON file into memory. Writes are debounced (default: 1000ms) to avoid excessive disk I/O. Implement all interface methods operating on the in-memory copy with debounced persistence. Handle missing file on first load (start with empty cache). Implement `flush()` to force immediate write. Implement `close()` to flush and release resources. | Status: not_done

- [ ] **Implement SQLite storage backend** — Create `src/storage/sqlite.ts` implementing `StorageBackend`. Use `better-sqlite3` (peer dependency). Create the schema on initialization with the specified table and indexes (`cache_entries` table with columns: `key`, `request_hash`, `messages`, `model`, `resolved_model`, `model_version`, `params`, `response`, `response_text`, `usage`, `finish_reason`, `created_at`, `accessed_at`, `hit_count`, `ttl`, `stale`, `stale_reason`, `metadata`). Enable WAL mode by default. Implement `query` using SQL `WHERE` clauses for model, modelVersion, stale filters. Implement `update` using SQL `UPDATE ... WHERE`. Implement LRU eviction via `DELETE FROM cache_entries ORDER BY accessed_at ASC LIMIT ?`. Implement `close()` to close the database connection. | Status: not_done

- [ ] **Implement SQLite schema indexes** — Create indexes on `model`, `model_version`, `accessed_at`, `created_at`, and `stale` columns for efficient queries during invalidation, eviction, and filtering. | Status: not_done

- [ ] **Implement Redis storage backend** — Create `src/storage/redis.ts` implementing `StorageBackend`. Use `ioredis` (peer dependency). Store each entry as a Redis hash with the configurable key prefix (default: `resp-cache:`). Use Redis `PEXPIRE` for TTL support. Implement `query` by scanning keys with the prefix and filtering. Track entries in a Redis sorted set keyed by access timestamp for LRU eviction. Implement `close()` to disconnect from Redis. | Status: not_done

- [ ] **Handle peer dependency availability** — In each persistent backend module (`sqlite.ts`, `redis.ts`), gracefully handle the case where the peer dependency is not installed. Throw a clear error message on instantiation: e.g., `"SQLite backend requires 'better-sqlite3' package. Install it with: npm install better-sqlite3"`. Use dynamic `require`/`import` to avoid hard dependency. | Status: not_done

- [ ] **Write filesystem storage tests** — Add tests for filesystem backend: set and get entries, persistence across flush calls, debounced writes, clear and delete operations, missing file on first load creates empty cache, query and update work on in-memory copy, close flushes pending writes. | Status: not_done

- [ ] **Write SQLite storage tests** — Add tests for SQLite backend: set and get entries, persistence across close/reopen cycles, WAL mode enabled, model-version invalidation via SQL queries, LRU eviction via SQL, query by model/modelVersion/stale, update stale flag for matching entries, indexes exist, schema creation is idempotent. | Status: not_done

- [ ] **Write Redis storage tests** — Add tests for Redis backend (using mock or test Redis instance): set and get entries, TTL support via PEXPIRE, key prefix applied, query and update operations, LRU eviction via sorted set, close disconnects, shared cache across simulated multiple clients. | Status: not_done

---

## Phase 10: Serialization

- [ ] **Implement `cache.serialize()`** — Create `src/serialization.ts` with logic to serialize the entire cache state to a binary buffer. Format: header with magic bytes (`LRCACHE`), format version, entry count; entry table with key, request parameters (JSON), response text (UTF-8), model, resolved model, version, timestamps, usage, metadata for each entry; stats block with cumulative hit/miss/cost counters. | Status: not_done

- [ ] **Implement `ResponseCache.deserialize(buffer, options?)`** — In `src/serialization.ts`, implement a static method on `ResponseCache` that reads a serialized buffer, validates the header (magic bytes, format version), reconstructs all cache entries, restores stats counters, and returns a new `ResponseCache` instance configured with the provided options (storage backend, maxEntries, etc.). | Status: not_done

- [ ] **Handle serialization edge cases** — Handle: empty cache serialization (valid buffer with zero entries), entries with null/undefined optional fields, very large response text, entries with tool call responses, binary data in metadata. Validate format version on deserialization and throw a clear error for unsupported versions. | Status: not_done

- [ ] **Write serialization.test.ts** — Create `src/__tests__/serialization.test.ts`. Test cases: serialize empty cache produces valid buffer, serialize/deserialize round-trip preserves all entries, all entry fields preserved (key, messages, model, resolvedModel, modelVersion, params, responseText, usage, finishReason, timestamps, hitCount, stale, staleReason, metadata), stats counters preserved, entries with various models and versions round-trip correctly, deserialization with different storage backend option works, invalid magic bytes throw error, unsupported format version throws error, large cache (1000+ entries) round-trips correctly. | Status: not_done

---

## Phase 11: CLI

- [ ] **Implement CLI entry point** — Create `src/cli.ts` using `node:util` `parseArgs` for argument parsing. Support subcommands: `stats`, `clear`, `invalidate`, `export`, `import`. Accept `--storage` flag to specify storage backend (default: memory, support sqlite path, redis URL). Accept `--format` flag for output format (json, text). Add shebang line `#!/usr/bin/env node`. | Status: not_done

- [ ] **Implement CLI `stats` command** — Display cache statistics: hits, misses, hit rate, entries, tokens saved, cost saved, model versions, stale entries. Support `--model` flag to filter by model. Support `--format json` for machine-readable output. | Status: not_done

- [ ] **Implement CLI `clear` command** — Clear all cache entries or entries for a specific model (`--model` flag). Print the number of entries cleared. Require confirmation unless `--force` flag is provided. | Status: not_done

- [ ] **Implement CLI `invalidate` command** — Invalidate entries for a specific model (`--model` flag) or all entries. Print the number of entries invalidated. | Status: not_done

- [ ] **Implement CLI `export` command** — Serialize the cache to a file. Accept `--output` flag for output path (default: stdout). Use the `cache.serialize()` method. | Status: not_done

- [ ] **Implement CLI `import` command** — Deserialize a cache from a file. Accept `--input` flag for input path (default: stdin). Use `ResponseCache.deserialize()`. Merge imported entries into the existing cache or replace (controlled by `--merge` flag). | Status: not_done

- [ ] **Write cli.test.ts** — Create `src/__tests__/cli.test.ts`. Test cases: `stats` command outputs correct format, `clear` command removes entries, `invalidate` command invalidates by model, `export`/`import` round-trip, `--format json` produces valid JSON, `--model` filter works, `--help` prints usage, unknown subcommand shows error, missing required arguments show error. | Status: not_done

---

## Phase 12: Integration Tests

- [ ] **End-to-end cache hit test** — Create cache, set entry with known messages/model/params/response, get with identical parameters, verify hit with correct response text, cached=true, correct model version. | Status: not_done

- [ ] **End-to-end cache miss test** — Create cache, get with parameters not in cache, verify null return, verify miss counter incremented. | Status: not_done

- [ ] **Parameter sensitivity test** — Set an entry, then get with each output-affecting parameter changed one at a time (temperature, model, max_tokens, tools, response_format, top_p, frequency_penalty, presence_penalty, seed, stop, logit_bias, tool_choice). Verify each produces a different key and a cache miss. | Status: not_done

- [ ] **Non-affecting parameter insensitivity test** — Set an entry, then get with non-affecting parameters added/changed (`stream`, `user`, `n`, `api_key`, `timeout`, `request_id`, `organization`). Verify each still produces a cache hit. | Status: not_done

- [ ] **Cache-through wrapper OpenAI integration test** — Wrap a mock OpenAI client, call `chat.completions.create`, verify first call goes to mock client (miss), second identical call returns from cache (hit) with `_cached: true` and zeroed usage. Verify response structure matches OpenAI format. | Status: not_done

- [ ] **Cache-through wrapper Anthropic integration test** — Wrap a mock Anthropic client, call `messages.create`, verify first call goes to mock (miss), second identical call returns from cache (hit) with `_cached: true`. Verify response structure matches Anthropic format. | Status: not_done

- [ ] **Model version change with auto strategy test** — Populate cache with entries from model version A, trigger version change to B (via set with different resolvedModel), verify old entries are deleted, verify new entry is stored with version B. | Status: not_done

- [ ] **Model version change with soft strategy test** — Populate cache, trigger version change, verify old entries are served with `stale: true` and correct `staleReason`, verify new entry stored with new version. | Status: not_done

- [ ] **Model version change with manual strategy test** — Populate cache, trigger version change, verify old entries are still served normally (no stale flag), verify manual `invalidate` call removes them. | Status: not_done

- [ ] **SQLite persistence integration test** — Create cache with SQLite backend, set entries, close cache, reopen with same db path, verify entries persist and are readable. Verify model-version invalidation works via the SQLite backend. | Status: not_done

- [ ] **Serialization round-trip integration test** — Create cache, add entries with various models and versions, serialize, deserialize into a new cache instance, verify all entries restored with correct data, verify stats preserved. | Status: not_done

- [ ] **Streaming cache miss integration test** — Wrap a mock client that returns a stream, verify stream is forwarded to caller in real time, verify response is cached on completion. | Status: not_done

- [ ] **Streaming cache hit integration test** — Set a cache entry, request with `stream: true`, verify cached response is replayed as an async iterable in all three modes (immediate, simulated, throttled). | Status: not_done

- [ ] **Layered caching integration test** — Create an exact cache, simulate the layered caching pattern (exact cache checked first, then fallback to LLM), verify exact matches are served from cache, verify misses fall through. | Status: not_done

---

## Phase 13: Edge Case Tests

- [ ] **Empty cache edge cases** — `cache.get` returns null on empty cache, `cache.stats()` returns all zeros, `cache.clear()` on empty cache does not throw, `cache.invalidate()` on empty cache returns 0, `cache.serialize()` on empty cache produces valid buffer. | Status: not_done

- [ ] **Identical request different key order** — Verify `{ model: "gpt-4o", temperature: 0 }` and `{ temperature: 0, model: "gpt-4o" }` produce the same cache key and share cache entries. | Status: not_done

- [ ] **Default vs explicit parameter handling** — Verify `{ temperature: undefined }` and `{}` produce the same key. Verify `{ temperature: 1 }` and `{}` produce different keys (cache does not assume it knows model defaults). | Status: not_done

- [ ] **Message content whitespace normalization** — Verify leading/trailing whitespace is trimmed from message content before hashing. Verify that `"  Hello  world  "` with configured normalizer and `"Hello world"` produce the same key. | Status: not_done

- [ ] **Unicode normalization** — Verify that equivalent Unicode sequences (composed vs decomposed forms, e.g., e-acute as single codepoint vs e + combining acute) produce the same key after NFC normalization. | Status: not_done

- [ ] **Very long messages** — Verify messages with 100,000+ characters hash correctly and in reasonable time (under 100ms). | Status: not_done

- [ ] **Concurrent access** — Verify multiple simultaneous `get` and `set` calls do not corrupt state in the in-memory backend. | Status: not_done

- [ ] **Process shutdown and close** — Verify `cache.close()` flushes pending writes for filesystem and SQLite backends. Verify close can be called multiple times without error. | Status: not_done

- [ ] **Empty response caching** — Verify a cached response with empty text (`""`) is valid, stored correctly, and returned on cache hit. | Status: not_done

- [ ] **Tool call response caching** — Verify responses containing tool calls (not just plain text) are cached and restored correctly, preserving the tool call structure. | Status: not_done

- [ ] **Multi-part message content** — Verify messages with multi-part content arrays (text parts and image URL parts) are normalized and hashed correctly. Image parts included by URL reference. | Status: not_done

- [ ] **Null/undefined in various positions** — Verify `null` usage field, `null` resolvedModel, `null` modelVersion, `null` metadata are all handled gracefully in set, get, serialize, and deserialize. | Status: not_done

---

## Phase 14: Performance Tests

- [ ] **Hash computation speed benchmark** — Benchmark SHA-256 computation of canonicalized requests at various sizes (1 KB, 5 KB, 10 KB serialized JSON). Assert sub-100 microseconds for 10 KB input. | Status: not_done

- [ ] **Cache hit total latency benchmark** — Benchmark the full pipeline for a cache hit: canonicalize + hash + in-memory lookup + TTL/staleness check + stats update. Assert sub-1ms for in-memory backend. | Status: not_done

- [ ] **Cache throughput benchmark** — Benchmark hits per second for in-memory backend with pre-populated cache. Target: >100,000 hits/second. | Status: not_done

- [ ] **Serialization speed benchmark** — Benchmark serialize/deserialize for 10,000 entries. Assert sub-1 second for each operation. | Status: not_done

- [ ] **Memory usage benchmark** — Measure memory footprint for 1,000, 10,000, and 50,000 entries with ~2KB average response size. Assert approximately linear scaling (~3KB per entry overhead). | Status: not_done

---

## Phase 15: Documentation

- [ ] **Write README.md** — Create a comprehensive README with: package description, installation instructions (core + optional backends), quick-start example (createCache + wrap), API reference for all public methods (`createCache`, `get`, `set`, `wrap`, `invalidate`, `stats`, `clear`, `delete`, `has`, `resetStats`, `serialize`, `deserialize`, `close`), configuration options table with types and defaults, storage backend configuration examples (memory, filesystem, SQLite, Redis, custom), model version invalidation explanation with examples, cost tracking explanation, streaming support documentation, integration examples with monorepo packages (`llm-semantic-cache`, `model-price-registry`, `prompt-dedup`, `llm-dedup`), CLI usage, performance characteristics. | Status: not_done

- [ ] **Add JSDoc comments to all public exports** — Add comprehensive JSDoc comments to all exported functions, classes, interfaces, and types in `src/index.ts`, `src/cache.ts`, `src/types.ts`. Include parameter descriptions, return types, usage examples, and links to related methods. | Status: not_done

---

## Phase 16: CI/CD and Publishing

- [ ] **Verify build passes** — Run `npm run build` (TypeScript compilation) and verify zero errors. Verify `dist/` output contains `index.js`, `index.d.ts`, and all compiled modules with source maps and declaration maps. | Status: not_done

- [ ] **Verify lint passes** — Run `npm run lint` and verify zero errors/warnings. Fix any lint issues. | Status: not_done

- [ ] **Verify all tests pass** — Run `npm run test` (vitest) and verify all unit, integration, edge case, and performance tests pass. | Status: not_done

- [ ] **Bump version in package.json** — Bump version from `0.1.0` to the appropriate version based on changes (likely `1.0.0` for initial feature-complete release). | Status: not_done

- [ ] **Publish to npm** — Follow monorepo workflow: merge PR to master, pull latest, run `npm publish` from the package directory. Verify `prepublishOnly` script runs build before publishing. | Status: not_done
