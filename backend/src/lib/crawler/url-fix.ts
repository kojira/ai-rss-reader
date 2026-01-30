import { DAO } from '../db';
import { fetchFinalUrl, closeBrowser } from './browser';

function isGoogleNewsUrl(url: string): boolean {
  return url.includes('news.google.com') || url.includes('news.url.google.com') || url.includes('google.com/url');
}

export async function migrateGoogleUrls() {
  console.log('Starting Google News URL migration...');
  
  // Find articles that are Google News links and don't have a resolved_url
  const allArticles = DAO.getArticles(1000, 0); // Get a batch
  const toProcess = allArticles.filter(a => isGoogleNewsUrl(a.url) && !a.resolved_url);
  
  console.log(`Found ${toProcess.length} articles to migrate.`);
  
  for (const article of toProcess) {
    console.log(`Resolving: ${article.url}`);
    try {
      const resolvedUrl = await fetchFinalUrl(article.url);
      if (resolvedUrl && resolvedUrl !== article.url) {
        DAO.saveArticle({
          url: article.url,
          resolved_url: resolvedUrl
        });
        console.log(`-> Resolved to: ${resolvedUrl}`);
      } else {
        console.log(`-> No change or resolution failed.`);
      }
    } catch (e: any) {
      console.error(`-> Error resolving ${article.url}: ${e.message}`);
    }
  }
  
  await closeBrowser();
  console.log('Migration complete.');
}

// To run this migration manually:
// npx ts-node -e "import { migrateGoogleUrls } from './src/lib/crawler/url-fix'; migrateGoogleUrls()"
