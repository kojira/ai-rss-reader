import { DAO } from '../db/index';
import { processArticle } from './article';

export async function backfillImages() {
  console.log('Starting image backfill process...');
  
  const articles = DAO.getArticlesWithoutImages(100);
  console.log(`Found ${articles.length} articles without image_url.`);

  let successCount = 0;
  for (const article of articles) {
    try {
      console.log(`Backfilling image for: ${article.original_title}`);
      const processed = await processArticle(article.url);
      
      if (processed) {
        DAO.saveArticle({
          url: article.url,
          image_url: processed.imageUrl || '' // Use empty string to avoid re-scanning failed ones if desired, or null to retry
        });
        if (processed.imageUrl) {
            console.log(`Successfully found image: ${processed.imageUrl}`);
            successCount++;
        }
      }
      
      // Rate limiting: wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      console.error(`Failed to backfill image for ${article.url}:`, e);
    }
  }

  console.log(`Backfill complete. Successfully found images for ${successCount} articles.`);
}
