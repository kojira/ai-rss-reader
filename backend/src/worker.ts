import { crawlAllFeeds } from './lib/crawler/rss';
import { backfillImages } from './lib/crawler/backfill';
import { evaluateArticle } from './lib/llm/evaluator';
import { sendDiscordNotification } from './lib/notifier/discord';
import { DAO } from './lib/db/index';
import { fullyProcessAndSaveArticle } from './lib/crawler/article';

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

    let currentPhase = 'CRAWL';
    let currentContext = 'Fetching and parsing article content';
    try {
      // 1. Crawl
      const processed = await processArticle(article.url);

      // 2. Save Initial
      DAO.saveArticle({
        url: processed.url,
        original_title: processed.title,
        content: processed.content,
        image_url: processed.imageUrl,
      });

      // 3. Evaluate
      currentPhase = 'EVAL';
      currentContext = 'Analyzing content with AI';
      const articleObj: CrawledArticle = {
        url: processed.url,
        title: processed.title,
        content: processed.content,
        originalUrl: article.url,
        pubDate: new Date().toISOString(),
        imageUrl: processed.imageUrl
      };

      const evaluation = await evaluateArticle(articleObj);
      if (!evaluation) {
        throw new Error('LLM Evaluation returned null or failed silently');
      }

      // 4. Update with Scores
      DAO.saveArticle({
        url: processed.url,
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

      // 5. Notify
      currentPhase = 'NOTIFY';
      currentContext = 'Sending Discord notification';
      await sendDiscordNotification(articleObj, evaluation).catch(e => console.error('Discord error:', e));
      
      // 6. Clear error if it succeeded
      DAO.clearError(article.url);
    } catch (e: any) {
      console.error(`Article failed but loop continues: ${article.url}`, e.message);
      
      let humanMessage = e.message;
      if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
        humanMessage = 'Failed to reach source (Timeout)';
      } else if (e.response?.status === 404) {
        humanMessage = 'Article not found (404)';
      } else if (e.message.includes('invalid JSON') || e.message.includes('LLM Evaluation')) {
        humanMessage = 'AI returned invalid analysis data';
      } else if (e.message.includes('Readability failed')) {
        humanMessage = 'Could not extract readable text from page';
      }

      DAO.logError(article.url, humanMessage, e.stack, article.original_title, currentPhase, currentContext);
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
