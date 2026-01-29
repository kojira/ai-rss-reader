import { collectAllArticleUrls, toQueuedArticles } from './lib/crawler/rss';
import { DomainQueueManager, processDomainQueue, QueuedArticle } from './lib/crawler/domain-queue';
import { crawlAndSaveArticle, evaluateExistingArticle } from './lib/crawler/article';
import { backfillImages } from './lib/crawler/backfill';
import { DAO } from './lib/db/index';
import { closeBrowser } from './lib/crawler/browser';

async function main() {
  console.log('Starting AI RSS Reader cycle (Parallel Pipeline)...');

  // --- Singleton / Self-Correction Check ---
  const initialStatus = DAO.getCrawlerStatus();
  if (initialStatus.is_crawling === 1 && initialStatus.worker_pid) {
    try {
      process.kill(initialStatus.worker_pid, 0);
      if (initialStatus.worker_pid !== process.pid && initialStatus.worker_pid !== process.ppid) {
        console.log(`Another worker running (PID: ${initialStatus.worker_pid}). Exiting.`);
        return;
      }
      console.log(`Confirmed PID ${initialStatus.worker_pid} is actually me or my parent.`);
    } catch (e) {
      console.log(`Stale worker PID ${initialStatus.worker_pid} detected. Clearing.`);
    }
  }

  DAO.updateCrawlerStatus({
    is_crawling: 1,
    worker_pid: process.pid,
    last_run: new Date().toISOString(),
    current_task: 'Initializing pipeline...'
  });

  // Ensure default feed if empty
  const sources = DAO.getRssSources();
  if (sources.length === 1 && sources[0].url.includes('google.com')) {
    DAO.deleteRssSource(sources[0].id);
  }

  const currentSources = DAO.getRssSources();
  if (currentSources.length === 0) {
    DAO.addRssSource('https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', 'NYT Tech');
  }

  const config = DAO.getConfig();

  try {
    // ============================================
    // PHASE 1: Collect all article URLs in parallel
    // ============================================
    DAO.updateCrawlerStatus({
      current_task: 'Phase 1: Collecting URLs from all feeds...',
      articles_processed: 0
    });

    const collectedArticles = await collectAllArticleUrls(config.feed_fetch_concurrency || 5);
    console.log(`Phase 1 complete: ${collectedArticles.length} articles to process`);

    // ============================================
    // PHASE 2: Domain-aware crawling
    // ============================================
    if (collectedArticles.length > 0) {
      DAO.updateCrawlerStatus({
        current_task: `Phase 2: Crawling ${collectedArticles.length} articles (domain-throttled)...`,
        articles_processed: 0
      });

      const domainQueue = new DomainQueueManager({
        maxConcurrentPerDomain: config.max_concurrent_per_domain || 2,
        maxTotalConcurrent: config.max_total_concurrent || 10,
        domainDelayMs: config.domain_delay_ms || 1000,
      });

      const queuedArticles = toQueuedArticles(collectedArticles);
      domainQueue.addArticles(queuedArticles);

      let crawlCount = 0;
      const totalToCrawl = collectedArticles.length;

      await processDomainQueue(
        domainQueue,
        async (article: QueuedArticle) => {
          crawlCount++;
          const stats = domainQueue.getStats();
          DAO.updateCrawlerStatus({
            current_task: `Phase 2: Crawling [${crawlCount}/${totalToCrawl}] (${stats.totalActive} active, ${stats.totalQueued} queued)...`,
            articles_processed: crawlCount
          });

          await crawlAndSaveArticle(article.url, {
            resolvedUrl: article.resolvedUrl,
            pubDate: article.pubDate,
            feedSource: article.feedSourceName,
          });
        }
      );

      console.log(`Phase 2 complete: ${crawlCount} articles crawled`);
    }

    await closeBrowser();

    // ============================================
    // PHASE 2.5: Backfill images
    // ============================================
    DAO.updateCrawlerStatus({ current_task: 'Phase 2.5: Backfilling images...' });
    await backfillImages();

    // ============================================
    // PHASE 3: Parallel LLM evaluation
    // ============================================
    const unprocessed = DAO.getUnprocessedArticles(200);

    if (unprocessed.length > 0) {
      console.log(`Phase 3: Evaluating ${unprocessed.length} articles in parallel...`);

      DAO.updateCrawlerStatus({
        current_task: `Phase 3: Evaluating ${unprocessed.length} articles...`,
        articles_processed: 0
      });

      let evalCount = 0;
      const evalConcurrency = config.eval_concurrency || 5;

      // Process evaluations in parallel batches
      for (let i = 0; i < unprocessed.length; i += evalConcurrency) {
        const batch = unprocessed.slice(i, i + evalConcurrency);

        await Promise.allSettled(
          batch.map(async (article) => {
            const success = await evaluateExistingArticle(article.url);
            evalCount++;
            DAO.updateCrawlerStatus({
              current_task: `Phase 3: Evaluating [${evalCount}/${unprocessed.length}]...`,
              articles_processed: evalCount
            });
            return success;
          })
        );
      }

      console.log(`Phase 3 complete: ${evalCount} articles evaluated`);
    } else {
      console.log('Phase 3: No articles need evaluation');
    }

  } finally {
    DAO.updateCrawlerStatus({
      is_crawling: 0,
      current_task: 'Idle',
      worker_pid: null
    });
    await closeBrowser();
    console.log('Pipeline cycle complete.');
  }
}

main().catch(e => {
  console.error('Pipeline failed:', e);
  DAO.updateCrawlerStatus({ is_crawling: 0, last_error: e.message });
});
