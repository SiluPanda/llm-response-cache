import type { CacheEntry } from './types';

class LRUNode {
  key: string;
  value: CacheEntry;
  prev: LRUNode | null = null;
  next: LRUNode | null = null;

  constructor(key: string, value: CacheEntry) {
    this.key = key;
    this.value = value;
  }
}

export class LRUStore {
  private map = new Map<string, LRUNode>();
  // Doubly-linked list: head.next = MRU, tail.prev = LRU
  private head: LRUNode;
  private tail: LRUNode;

  constructor(private maxEntries: number, private ttlMs: number) {
    // Sentinel nodes
    this.head = new LRUNode('__head__', {} as CacheEntry);
    this.tail = new LRUNode('__tail__', {} as CacheEntry);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  private isExpired(entry: CacheEntry): boolean {
    if (this.ttlMs <= 0) return false;
    return Date.now() - entry.createdAt > this.ttlMs;
  }

  private removeNode(node: LRUNode): void {
    const prev = node.prev!;
    const next = node.next!;
    prev.next = next;
    next.prev = prev;
    node.prev = null;
    node.next = null;
  }

  private insertAfterHead(node: LRUNode): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  get(key: string): CacheEntry | null {
    const node = this.map.get(key);
    if (!node) return null;
    if (this.isExpired(node.value)) {
      this.removeNode(node);
      this.map.delete(key);
      return null;
    }
    // Move to MRU position
    this.removeNode(node);
    this.insertAfterHead(node);
    return node.value;
  }

  peek(key: string): CacheEntry | null {
    const node = this.map.get(key);
    if (!node) return null;
    if (this.isExpired(node.value)) {
      this.removeNode(node);
      this.map.delete(key);
      return null;
    }
    return node.value;
  }

  set(key: string, entry: CacheEntry): void {
    if (this.map.has(key)) {
      const existing = this.map.get(key)!;
      existing.value = entry;
      this.removeNode(existing);
      this.insertAfterHead(existing);
      return;
    }

    const node = new LRUNode(key, entry);
    this.map.set(key, node);
    this.insertAfterHead(node);

    // Evict LRU if over capacity
    if (this.maxEntries > 0 && this.map.size > this.maxEntries) {
      const lru = this.tail.prev!;
      if (lru !== this.head) {
        this.removeNode(lru);
        this.map.delete(lru.key);
      }
    }
  }

  delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  invalidate(model?: string): number {
    let count = 0;
    if (model === undefined) {
      count = this.map.size;
      this.clear();
      return count;
    }
    const toDelete: string[] = [];
    for (const [key, node] of this.map.entries()) {
      if (node.value.model === model) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.delete(key);
      count++;
    }
    return count;
  }

  clear(): void {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  all(): CacheEntry[] {
    const result: CacheEntry[] = [];
    const expired: LRUNode[] = [];
    let node = this.head.next;
    while (node && node !== this.tail) {
      const next = node.next;
      if (this.isExpired(node.value)) {
        expired.push(node);
      } else {
        result.push(node.value);
      }
      node = next;
    }
    for (const n of expired) {
      this.removeNode(n);
      this.map.delete(n.key);
    }
    return result;
  }

  size(): number {
    return this.map.size;
  }
}
