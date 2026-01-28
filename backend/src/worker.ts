import { crawlAllFeeds } from './lib/crawler/rss';
import { backfillImages } from './lib/crawler/backfill';
import { evaluateArticle } from './lib/llm/evaluator';
import { sendDiscordNotification } from './lib/notifier/discord';
import { DAO } from './lib/db/index';

async function main() {
  console.log('Starting AI RSS Reader cycle...');
  DAO.updateCrawlerStatus({ 
    is_crawling: 1, 
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

  // 1. Crawl Phase
  DAO.updateCrawlerStatus({ current_task: 'Phase 1: Crawling all feeds (Parallel)...' });
  await crawlAllFeeds();

  // Backfill Phase
  DAO.updateCrawlerStatus({ current_task: 'Phase: Backfilling images...' });
  await backfillImages();
  
  // 2. Evaluation Phase
  const unprocessed = DAO.getUnprocessedArticles(50);
  console.log(`Phase 2: Evaluating ${unprocessed.length} new articles.`);
  
  let processedCount = 0;
  for (const article of unprocessed) {
    processedCount++;
    DAO.updateCrawlerStatus({ 
      current_task: `Phase 2: Evaluating [${processedCount}/${unprocessed.length}] ${article.original_title.slice(0, 20)}...`,
      articles_processed: processedCount
    });

    const evaluation = await evaluateArticle({
      url: article.url,
      title: article.original_title,
      content: article.content || '',
      originalUrl: article.url,
      pubDate: article.created_at
    });

    if (evaluation) {
      DAO.saveArticle({
        url: article.url,
        translated_title: evaluation.translatedTitle,
        summary: evaluation.summary,
        short_summary: evaluation.shortSummary,
        score_novelty: evaluation.scores.novelty,
        score_importance: evaluation.scores.importance,
        score_reliability: evaluation.scores.reliability,
        score_context_value: evaluation.scores.contextValue,
        score_thought_provoking: evaluation.scores.thoughtProvoking,
        average_score: evaluation.averageScore
      });

      await sendDiscordNotification({
        url: article.url,
        title: article.original_title,
        content: article.content || '',
        originalUrl: article.url,
        pubDate: article.created_at
      }, evaluation);
    }
  }

  DAO.updateCrawlerStatus({ 
    is_crawling: 0, 
    current_task: 'Idle',
    articles_processed: processedCount
  });
  console.log('Cycle complete.');
}

main().catch(e => {
  console.error(e);
  DAO.updateCrawlerStatus({ is_crawling: 0, last_error: e.message });
});
