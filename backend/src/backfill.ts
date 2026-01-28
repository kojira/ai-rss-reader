import db from './lib/db';
import { processArticle } from './lib/crawler/article';

async function backfill() {
  console.log('Starting OG Image backfill...');
  
  const articles = db.prepare("SELECT id, url FROM articles WHERE image_url IS NULL OR image_url = ''").all() as { id: number, url: string }[];
  
  console.log(`Found ${articles.length} articles to process.`);
  
  for (const article of articles) {
    console.log(`Processing article ${article.id}: ${article.url}`);
    try {
      const result = await processArticle(article.url);
      if (result && result.imageUrl) {
        db.prepare('UPDATE articles SET image_url = ? WHERE id = ?').run(result.imageUrl, article.id);
        console.log(`Updated article ${article.id} with image: ${result.imageUrl}`);
      } else {
        console.log(`No image found for article ${article.id}`);
      }
    } catch (e) {
      console.error(`Error backfilling article ${article.id}:`, e);
    }
    // Small delay to be polite
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('Backfill complete.');
  process.exit(0);
}

backfill();
