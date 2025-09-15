// Centralized caching system for AgentFlow
import { logger } from './logger';

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  maxSize?: number; // Maximum number of entries
}

class CacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize: number;
  private defaultTtl: number;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTtl = options.ttl || 300; // 5 minutes default
  }

  set<T>(key: string, value: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.defaultTtl) * 1000;
    const entry: CacheEntry<T> = {
      value,
      expiresAt,
      createdAt: Date.now()
    };

    // Remove expired entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.cleanup();
    }

    this.cache.set(key, entry);
    logger.debug('Cache entry set', { key, ttl: ttl || this.defaultTtl });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      logger.debug('Cache entry expired', { key });
      return null;
    }

    logger.debug('Cache hit', { key });
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug('Cache entry deleted', { key });
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    logger.debug('Cache cleared');
  }

  private cleanup(): void {
    const now = Date.now();
    let removedCount = 0;

    // Remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    // If still over limit, remove oldest entries
    if (this.cache.size >= this.maxSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].createdAt - b[1].createdAt);
      
      const toRemove = entries.slice(0, this.cache.size - this.maxSize + 1);
      for (const [key] of toRemove) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug('Cache cleanup completed', { removedCount, remainingSize: this.cache.size });
    }
  }

  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    expiredEntries: number;
  } {
    const now = Date.now();
    let expiredCount = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expiredCount++;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // Would need to track hits/misses for this
      expiredEntries: expiredCount
    };
  }
}

// Singleton cache manager instance
export const cacheManager = new CacheManager({
  ttl: 300, // 5 minutes default
  maxSize: 1000
});

// Helper functions for common cache operations
export function cacheKey(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}:${parts.join(':')}`;
}

export function withCache<T>(
  key: string,
  operation: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = cacheManager.get<T>(key);
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  return operation().then(result => {
    cacheManager.set(key, result, ttl);
    return result;
  });
}

export function invalidateCache(pattern: string): void {
  const keys = Array.from(cacheManager['cache'].keys());
  const regex = new RegExp(pattern);
  
  for (const key of keys) {
    if (regex.test(key)) {
      cacheManager.delete(key);
    }
  }
}

// Specific cache invalidation functions for different entities
export function invalidateAgentCache(organizationId: string, agentId?: string): void {
  if (agentId) {
    // Invalidate specific agent cache
    const agentKey = cacheKey('agent', organizationId, agentId);
    cacheManager.delete(agentKey);
    logger.debug('Invalidated agent cache', { organizationId, agentId });
  } else {
    // Invalidate all agent caches for organization
    const pattern = `^agent:${organizationId}:`;
    invalidateCache(pattern);
    logger.debug('Invalidated all agent caches', { organizationId });
  }
}

export function invalidateToolCache(organizationId: string, toolId?: string): void {
  if (toolId) {
    // Invalidate specific tool cache
    const toolKey = cacheKey('tool', organizationId, toolId);
    cacheManager.delete(toolKey);
    logger.debug('Invalidated tool cache', { organizationId, toolId });
  } else {
    // Invalidate all tool caches for organization
    const pattern = `^tool:${organizationId}:`;
    invalidateCache(pattern);
    logger.debug('Invalidated all tool caches', { organizationId });
  }
}

export function invalidateOrganizationCache(organizationId: string): void {
  // Invalidate all caches for an organization
  const patterns = [
    `^agent:${organizationId}:`,
    `^tool:${organizationId}:`,
    `^config:${organizationId}:`
  ];
  
  patterns.forEach(pattern => invalidateCache(pattern));
  logger.debug('Invalidated all organization caches', { organizationId });
}