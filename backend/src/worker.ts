import { crawlAllFeeds } from './lib/crawler/rss';
import { backfillImages } from './lib/crawler/backfill';
import { evaluateArticle } from './lib/llm/evaluator';
import { sendDiscordNotification } from './lib/notifier/discord';
import { DAO } from './lib/db/index';
import { fullyProcessAndSaveArticle } from './lib/crawler/article';

async function main() {
  console.log('Starting AI RSS Reader cycle...');

  // --- Singleton / Self-Correction Check ---
  const initialStatus = DAO.getCrawlerStatus();
  if (initialStatus.is_crawling === 1 && initialStatus.worker_pid) {
    try {
      process.kill(initialStatus.worker_pid, 0);
      if (initialStatus.worker_pid !== process.pid && initialStatus.worker_pid !== process.ppid) {
        console.log(`Another worker is already running (PID: ${initialStatus.worker_pid}, Mine: ${process.pid}, Parent: ${process.ppid}). Exiting.`);
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
    current_task: 'Initializing...'
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

  // --- High Priority: Backfill Unprocessed Articles IMMEDIATELY ---
  const pending = DAO.getUnprocessedArticles(50);
  if (pending.length > 0) {
    console.log(`High Priority: Processing ${pending.length} existing articles first.`);
    DAO.updateCrawlerStatus({ current_task: `Backfilling ${pending.length} unprocessed articles...` });
    
    let backfillCount = 0;
    for (const article of pending) {
      backfillCount++;
      DAO.updateCrawlerStatus({ 
        current_task: `Backfilling [${backfillCount}/${pending.length}] ${article.original_title.slice(0, 20)}...`,
        articles_processed: backfillCount
      });
      try {
        await fullyProcessAndSaveArticle(article.url);
      } catch (e: any) {
        console.error(`Backfill failed for ${article.url}:`, e.message);
      }
    }
  }

  // 1. Crawl Phase
  DAO.updateCrawlerStatus({ 
    current_task: 'Phase 1: Crawling all feeds (Parallel)...',
    articles_processed: 0 
  });
  await crawlAllFeeds();

  // Backfill Phase (Images)
  DAO.updateCrawlerStatus({ current_task: 'Phase: Backfilling images...' });
  await backfillImages();
  
  // 2. Evaluation Phase (New Articles)
  const unprocessed = DAO.getUnprocessedArticles(50);
  console.log(`Phase 2: Evaluating ${unprocessed.length} new articles.`);
  
  let processedCount = 0;
  for (const article of unprocessed) {
    processedCount++;
    DAO.updateCrawlerStatus({ 
      current_task: `Phase 2: Evaluating [${processedCount}/${unprocessed.length}] ${article.original_title.slice(0, 20)}...`,
      articles_processed: processedCount
    });

    try {
      await fullyProcessAndSaveArticle(article.url);
    } catch (e: any) {
      console.error(`Article failed but loop continues: ${article.url}`, e.message);
    }
  }

  DAO.updateCrawlerStatus({ 
    is_crawling: 0, 
    current_task: 'Idle',
    articles_processed: processedCount,
    worker_pid: null
  });
  console.log('Cycle complete.');
}

main().catch(e => {
  console.error(e);
  DAO.updateCrawlerStatus({ is_crawling: 0, last_error: e.message });
});
