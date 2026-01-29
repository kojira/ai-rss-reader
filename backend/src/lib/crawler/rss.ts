import Parser from 'rss-parser';
import { chromium } from 'playwright';
import { fetchFinalUrl, closeBrowser } from './browser';
import { processArticle } from './article';
import { DAO } from '../db/index';
import { CrawledArticle } from '../types';

const parser = new Parser();

export function isGoogleNewsUrl(url: string): boolean {
  return url.includes('news.google.com/rss/articles/');
}

export function extractUrlFromBase64(url: string): string | null {
  const match = url.match(/\/articles\/([^?]+)/);
  if (!match) return null;
  const encoded = match[1];
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    const httpMatch = decoded.match(/https?:\/\/[^\x00-\x1f\s]+/);
    return httpMatch ? httpMatch[0] : null;
  } catch (e) {
    return null;
  }
}

export async function resolveUrl(url: string): Promise<string> {
  if (!isGoogleNewsUrl(url)) return url;
  const extracted = extractUrlFromBase64(url);
  if (extracted) return extracted;
  return await fetchFinalUrl(url);
}

async function fetchRssContentWithBrowser(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const xml = await page.evaluate(() => document.querySelector('pre')?.textContent || document.body.innerText);
    return xml;
  } finally {
    await browser.close();
  }
}

export async function crawlAllFeeds(): Promise<CrawledArticle[]> {
  const sources = DAO.getRssSources();
  const allArticles: CrawledArticle[] = [];

  for (const source of sources) {
    console.log(`Crawling source: ${source.name} (${source.url})`);
    try {
      let feed;
      try {
        feed = await parser.parseURL(source.url);
      } catch (e) {
        const xml = await fetchRssContentWithBrowser(source.url);
        feed = await parser.parseString(xml);
      }

      const tasks = feed.items.map(async (item) => {
        if (!item.link) return;

        const existing = DAO.getArticleByUrl(item.link);
        if (existing && existing.content && existing.content.length > 200) {
          return;
        }

        try {
          const resolvedUrl = await resolveUrl(item.link);
          const processed = await processArticle(resolvedUrl);
          
          if (processed) {
            DAO.saveArticle({
              url: item.link, // Keep the original RSS link as the unique key
              original_title: processed.title || item.title || 'Untitled',
              content: processed.content,
              image_url: processed.imageUrl || null,
              // scores and summary left null/empty for now
            });
            return true;
          }
        } catch (e) {
          console.error(`Error processing item ${item.link}:`, e);
        }
        return false;
      });

      // Simple concurrency limit of 4
      for (let i = 0; i < tasks.length; i += 4) {
        await Promise.all(tasks.slice(i, i + 4));
      }
    } catch (e) {
      console.error(`Failed to crawl ${source.url}:`, e);
    }
  }

  await closeBrowser();
  return allArticles;
}
