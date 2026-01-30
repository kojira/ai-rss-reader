/**
 * Domain-aware request queue manager
 *
 * Manages parallel article processing while:
 * - Limiting concurrent requests per domain
 * - Adding delays between same-domain requests
 * - Respecting total concurrent limit
 * - Handling Google News redirects (uses resolved URL domain)
 */

export interface QueuedArticle {
  url: string;           // Original URL (e.g., Google News)
  resolvedUrl: string;   // Actual target URL
  pubDate?: string;
  feedSourceName: string;
  title?: string;
  rssItemJson?: string;  // Raw RSS item for future analysis
}

export interface DomainQueueConfig {
  maxConcurrentPerDomain: number;  // Max concurrent requests per domain (default: 2)
  maxTotalConcurrent: number;      // Max total concurrent requests (default: 10)
  domainDelayMs: number;           // Delay between same-domain requests (default: 1000)
}

const DEFAULT_CONFIG: DomainQueueConfig = {
  maxConcurrentPerDomain: 2,
  maxTotalConcurrent: 10,
  domainDelayMs: 1000,
};

export class DomainQueueManager {
  private queues: Map<string, QueuedArticle[]> = new Map();
  private activeCounts: Map<string, number> = new Map();
  private lastRequestTime: Map<string, number> = new Map();
  private totalActive: number = 0;
  private config: DomainQueueConfig;

  constructor(config: Partial<DomainQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extract domain from URL for throttling purposes.
   * Uses resolvedUrl to get actual target domain (important for Google News).
   */
  private extractDomain(article: QueuedArticle): string {
    // Use resolved URL to get actual target domain
    const url = article.resolvedUrl || article.url;
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Add articles to domain-specific queues
   */
  addArticles(articles: QueuedArticle[]): void {
    for (const article of articles) {
      const domain = this.extractDomain(article);
      if (!this.queues.has(domain)) {
        this.queues.set(domain, []);
        this.activeCounts.set(domain, 0);
      }
      this.queues.get(domain)!.push(article);
    }
  }

  /**
   * Get next available article respecting domain limits and delays
   */
  getNextAvailable(): QueuedArticle | null {
    if (this.totalActive >= this.config.maxTotalConcurrent) {
      return null;
    }

    const now = Date.now();

    // Find a domain that can process
    for (const [domain, queue] of this.queues) {
      if (queue.length === 0) continue;

      const activeCount = this.activeCounts.get(domain) ?? 0;
      if (activeCount >= this.config.maxConcurrentPerDomain) continue;

      const lastTime = this.lastRequestTime.get(domain) ?? 0;
      if (now - lastTime < this.config.domainDelayMs) continue;

      // Found available article
      const article = queue.shift()!;
      this.activeCounts.set(domain, activeCount + 1);
      this.lastRequestTime.set(domain, now);
      this.totalActive++;

      return article;
    }

    return null;
  }

  /**
   * Get time until next article might be available (for efficient waiting)
   */
  getWaitTime(): number {
    if (this.totalActive >= this.config.maxTotalConcurrent) {
      return 100; // Check again soon
    }

    const now = Date.now();
    let minWait = Infinity;

    for (const [domain, queue] of this.queues) {
      if (queue.length === 0) continue;

      const activeCount = this.activeCounts.get(domain) ?? 0;
      if (activeCount >= this.config.maxConcurrentPerDomain) continue;

      const lastTime = this.lastRequestTime.get(domain) ?? 0;
      const elapsed = now - lastTime;
      const remaining = this.config.domainDelayMs - elapsed;

      if (remaining <= 0) return 0; // Available now
      minWait = Math.min(minWait, remaining);
    }

    return minWait === Infinity ? 100 : minWait;
  }

  /**
   * Mark article processing as complete
   */
  markComplete(article: QueuedArticle): void {
    const domain = this.extractDomain(article);
    const current = this.activeCounts.get(domain) ?? 1;
    this.activeCounts.set(domain, Math.max(0, current - 1));
    this.totalActive = Math.max(0, this.totalActive - 1);
  }

  /**
   * Check if all queues are empty and no active processing
   */
  isEmpty(): boolean {
    if (this.totalActive > 0) return false;
    for (const queue of this.queues.values()) {
      if (queue.length > 0) return false;
    }
    return true;
  }

  /**
   * Get statistics for status reporting
   */
  getStats(): { totalQueued: number; totalActive: number; domainCount: number } {
    let totalQueued = 0;
    for (const queue of this.queues.values()) {
      totalQueued += queue.length;
    }
    return {
      totalQueued,
      totalActive: this.totalActive,
      domainCount: this.queues.size,
    };
  }
}

/**
 * Process articles through domain queue with async callback
 */
export async function processDomainQueue(
  queue: DomainQueueManager,
  processor: (article: QueuedArticle) => Promise<void>,
  onProgress?: (stats: { totalQueued: number; totalActive: number }) => void
): Promise<void> {
  const activePromises: Map<QueuedArticle, Promise<void>> = new Map();

  while (!queue.isEmpty()) {
    // Try to get next available article
    const article = queue.getNextAvailable();

    if (article) {
      // Start processing
      const promise = (async () => {
        try {
          await processor(article);
        } finally {
          queue.markComplete(article);
          activePromises.delete(article);
        }
      })();

      activePromises.set(article, promise);

      // Report progress
      if (onProgress) {
        onProgress(queue.getStats());
      }
    } else if (activePromises.size > 0) {
      // Wait for next available slot
      const waitTime = queue.getWaitTime();
      if (waitTime > 0) {
        await Promise.race([
          ...activePromises.values(),
          new Promise(resolve => setTimeout(resolve, waitTime))
        ]);
      }
    } else {
      // Brief pause if nothing available but queue not empty
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  // Wait for all remaining
  if (activePromises.size > 0) {
    await Promise.allSettled(activePromises.values());
  }
}
