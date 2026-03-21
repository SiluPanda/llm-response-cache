export interface CacheableMessage {
  role: string;
  content: string | unknown[];
}

export interface CacheableResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface CacheEntry {
  key: string;
  response: CacheableResponse;
  createdAt: number;
  lastAccessedAt: number;
  hitCount: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalEntries: number;
  tokensSaved: number;
  estimatedCostSaved: number;
}

export interface CacheState {
  entries: CacheEntry[];
  stats: { hits: number; misses: number };
  version: 1;
}

export interface EvictionConfig {
  maxEntries?: number;
  ttlMs?: number;
  strategy?: 'lru' | 'ttl' | 'none';
}

export interface ResponseCacheOptions {
  eviction?: EvictionConfig;
  pricePerMTokInput?: number;
  pricePerMTokOutput?: number;
}

export interface ResponseCache {
  get(messages: CacheableMessage[], model: string, params?: Record<string, unknown>): CacheEntry | null;
  set(messages: CacheableMessage[], model: string, params: Record<string, unknown> | undefined, response: CacheableResponse): void;
  wrap<T extends object>(
    client: T,
    options?: {
      extractMessages?: (args: unknown[]) => { messages: CacheableMessage[]; model: string; params: Record<string, unknown> };
      extractResponse?: (response: unknown) => CacheableResponse;
    }
  ): T;
  stats(): CacheStats;
  invalidate(model?: string): number;
  clear(): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  getByKey(key: string): CacheEntry | null;
  buildKey(messages: CacheableMessage[], model: string, params?: Record<string, unknown>): string;
  serialize(): CacheState;
  readonly size: number;
}
