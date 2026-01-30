import Parser from 'rss-parser';
import * as fs from 'fs';
import { chromium } from 'playwright';
import { fetchFinalUrl } from './browser';
import { DAO } from '../db/index';
import { QueuedArticle } from './domain-queue';

const parser = new Parser();

export interface CollectedArticle {
  url: string;           // Original URL (e.g., Google News)
  resolvedUrl: string;   // Actual target URL
  pubDate?: string;
  feedSourceName: string;
  feedSourceId: number;
  title?: string;
}

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
    const xml = await page.evaluate(() => {
	  const pre = document.querySelector('pre');
	  if (pre) return pre.textContent || '';
	  // XML direct view in some browsers might be in a different structure
	  return document.documentElement.outerHTML || document.body.innerText;
	});
    return xml;
  } finally {
    await browser.close();
  }
}

/**
 * Collect article URLs from a single feed (no processing, just URL collection)
 */
async function collectFeedUrls(source: { id: number; url: string; name: string }): Promise<CollectedArticle[]> {
  const articles: CollectedArticle[] = [];

  try {
    let feed;
    if (source.url.startsWith('file://')) {
      const filePath = source.url.replace('file://', '');
      const xml = fs.readFileSync(filePath, 'utf-8');
      feed = await parser.parseString(xml);
    } else {
      try {
        feed = await parser.parseURL(source.url);
      } catch (e: any) {
        console.log(`parseURL failed for ${source.name}: ${e.message}. Trying browser fallback.`);
        const xml = await fetchRssContentWithBrowser(source.url);
        feed = await parser.parseString(xml);
      }
    }

    // Resolve URLs in parallel (for Google News redirect resolution)
    const resolvePromises = feed.items
      .filter(item => item.link)
      .map(async (item) => {
        // Skip if already fully processed
        const existing = DAO.getArticleByUrl(item.link!);
        if (existing?.content && existing.content.length > 200 && existing.average_score !== null) {
          return null;
        }

        try {
          const resolvedUrl = await resolveUrl(item.link!);
          return {
            url: item.link!,
            resolvedUrl,
            pubDate: item.pubDate,
            feedSourceName: source.name,
            feedSourceId: source.id,
            title: item.title,
          };
        } catch (e: any) {
          console.error(`Failed to resolve URL ${item.link}:`, e.message);
          return null;
        }
      });

    // Process URL resolution with limited concurrency
    for (let i = 0; i < resolvePromises.length; i += 5) {
      const batch = resolvePromises.slice(i, i + 5);
      const results = await Promise.all(batch);
      for (const result of results) {
        if (result) articles.push(result);
      }
    }
  } catch (e: any) {
    const isKnownError = e.message?.includes('Timeout') || e.name === 'TimeoutError';
    if (isKnownError) {
      console.error(`Failed to collect from ${source.name}: ${e.message}`);
    } else {
      // Import formatError from article.ts or inline it
      const errorMsg = e.isAxiosError ? `${e.message}${e.cause?.message ? ` [${e.cause.message}]` : ''}` : (e.message || String(e));
      console.error(`Failed to collect from ${source.name}: ${errorMsg}`);
    }
  }

  return articles;
}

/**
 * Collect article URLs from all RSS feeds in parallel
 * Returns deduplicated list of articles with resolved URLs
 */
export async function collectAllArticleUrls(concurrency: number = 5): Promise<CollectedArticle[]> {
  const sources = DAO.getRssSources();
  const allArticles: CollectedArticle[] = [];

  console.log(`Collecting URLs from ${sources.length} RSS sources (concurrency: ${concurrency})...`);

  // Process feeds in parallel batches
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(source => {
        console.log(`  Fetching: ${source.name}`);
        return collectFeedUrls(source);
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value);
      }
    }
  }

  // Deduplicate by resolved URL (actual target domain)
  const seen = new Set<string>();
  const unique = allArticles.filter(a => {
    const key = a.resolvedUrl || a.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Collected ${unique.length} unique article URLs from ${sources.length} feeds`);
  return unique;
}

/**
 * Convert CollectedArticle to QueuedArticle for domain queue
 */
export function toQueuedArticles(articles: CollectedArticle[]): QueuedArticle[] {
  return articles.map(a => ({
    url: a.url,
    resolvedUrl: a.resolvedUrl,
    pubDate: a.pubDate,
    feedSourceName: a.feedSourceName,
    title: a.title,
  }));
}
