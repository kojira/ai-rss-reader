import axios from 'axios';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { TextDecoder } from 'util';
import pdf from 'pdf-parse';
import path from 'path';
import { DAO } from '../db';
import { evaluateArticle } from '../llm/evaluator';
import { sendDiscordNotification } from '../notifier/discord';
import { CrawledArticle } from '../types';
import { fetchFinalUrl, fetchWithBrowser } from './browser';

// JSDOMのCSSパースエラーを抑制
const virtualConsole = new VirtualConsole();
virtualConsole.on('error', () => {}); // エラーを無視

/**
 * Extract concise error message (avoids dumping huge axios error objects)
 */
export function formatError(e: any): string {
  // Axios errors have a special structure
  if (e.isAxiosError || e.config) {
    const status = e.response?.status || '';
    const statusText = e.response?.statusText || '';
    const cause = e.cause?.message || e.cause?.code || '';
    const msg = e.message || 'Unknown axios error';
    return `${msg}${status ? ` (HTTP ${status} ${statusText})` : ''}${cause ? ` [${cause}]` : ''}`;
  }
  // Playwright errors
  if (e.name === 'TimeoutError') {
    return `Timeout: ${e.message}`;
  }
  // Default
  return e.message || String(e);
}

function isGoogleNewsUrl(url: string): boolean {
  return url.includes('news.google.com') || url.includes('news.url.google.com') || url.includes('google.com/url');
}

export async function processArticle(url: string) {
  let targetUrl = url;
  let resolvedUrl: string | null = null;

  // 既にDBにresolved_urlが保存されている場合はそれを使う
  const existingArticle = DAO.getArticleByUrl(url);
  if (existingArticle?.resolved_url) {
    targetUrl = existingArticle.resolved_url;
    resolvedUrl = existingArticle.resolved_url;
    console.log(`Using cached resolved URL: ${targetUrl}`);
  } else if (isGoogleNewsUrl(url)) {
    console.log(`Google News URL detected, resolving redirect: ${url}`);
    try {
      targetUrl = await fetchFinalUrl(url);
      resolvedUrl = targetUrl;
      console.log(`Resolved to: ${targetUrl}`);
      // resolved_urlを即座に保存（次回以降のために）
      DAO.saveArticle({ url, resolved_url: resolvedUrl });
    } catch (e: any) {
      console.error(`Failed to resolve Google News URL: ${e.message}`);
    }
  }

  // ブロックリストのチェック
  try {
    const domain = new URL(targetUrl).hostname;
    if (DAO.isBlockedDomain(domain)) {
      throw new Error(`Domain is blocked (bot protection): ${domain}`);
    }
  } catch (e: any) {
    if (e.message.includes('blocked')) throw e;
  }

  try {
    let html: string;
    let finalUrl: string;
    let contentType = '';
    let buffer: Buffer | null = null;

    // 最初にaxiosで試す
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
      },
      timeout: 15000,
      responseType: 'arraybuffer',
      validateStatus: (status) => status < 500,
    });

    if (response.status === 404) {
      throw new Error(`Article not found (404): ${targetUrl}`);
    }

    // 401/403などのエラーはPlaywrightでフォールバック
    let axiosFailedWith401or403 = false;
    if (response.status >= 400) {
      axiosFailedWith401or403 = response.status === 401 || response.status === 403;
      console.log(`Axios failed with ${response.status}, trying Playwright: ${targetUrl}`);
      try {
        const browserResult = await fetchWithBrowser(targetUrl);
        html = browserResult.html;
        finalUrl = browserResult.finalUrl;
      } catch (browserError: any) {
        // Playwrightも失敗した場合、401/403ならブロックリストに追加
        if (axiosFailedWith401or403) {
          const domain = new URL(targetUrl).hostname;
          console.log(`Both axios and Playwright failed for ${domain}, adding to blocklist`);
          DAO.addBlockedDomain(domain, `HTTP ${response.status} + browser fetch failed`);
        }
        throw browserError;
      }
    } else {
      contentType = response.headers['content-type'] || '';
      buffer = Buffer.from(response.data);
      finalUrl = (response.request?.res?.responseUrl as string) || targetUrl;

      const isPdf = contentType.includes('application/pdf') || targetUrl.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        const data = await pdf(buffer);
        if (!data.text || data.text.trim().length === 0) {
          throw new Error(`PDF contains no extractable text: ${targetUrl}`);
        }

        let title = data.info?.Title || '';
        if (!title || title === 'Untitled' || title.trim() === '') {
          try {
            const parsedUrl = new URL(targetUrl);
            title = path.basename(parsedUrl.pathname);
          } catch {
            title = '';
          }
        }

        if (!title) {
          throw new Error(`Could not determine title for PDF: ${targetUrl}`);
        }

        return {
          title: title,
          content: data.text.trim(),
          imageUrl: '',
          url: url, // Keep original
          resolvedUrl: finalUrl
        };
      }

      const decoder = new TextDecoder('utf-8');
      html = decoder.decode(buffer);
    }

    // YouTube handling (basic meta tag capture if transcripts unavailable)
    if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
      const dom = new JSDOM(html, { url: targetUrl, virtualConsole });
      const title = dom.window.document.querySelector('title')?.textContent || '';
      const description = dom.window.document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

      if (title && description) {
        return {
          title,
          content: `YouTube Video: ${title}\n\nDescription:\n${description}`,
          imageUrl: dom.window.document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '',
          url: url,
          resolvedUrl: finalUrl
        };
      }
    }

    const dom = new JSDOM(html, { url: targetUrl, virtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.title || !article.textContent || article.textContent.trim().length < 50) {
      throw new Error(`Readability failed to extract valid content from ${targetUrl}`);
    }

    const imageUrl = dom.window.document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
                     dom.window.document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');

    return {
      title: article.title,
      content: article.textContent.trim(),
      imageUrl: imageUrl || '',
      url: url,
      resolvedUrl: finalUrl
    };
  } catch (e: any) {
    console.error(`Error processing article ${targetUrl}:`, e.message);
    throw e;
  }
}

/**
 * Crawl article and save to DB (no LLM evaluation)
 * Used by the parallel pipeline for Phase 2
 */
export async function crawlAndSaveArticle(
  url: string,
  metadata?: { resolvedUrl?: string; pubDate?: string; feedSource?: string }
): Promise<{ url: string; success: boolean; hasContent: boolean }> {
  try {
    const processed = await processArticle(url);

    DAO.saveArticle({
      url: processed.url,
      resolved_url: metadata?.resolvedUrl || processed.resolvedUrl,
      original_title: processed.title,
      content: processed.content,
      image_url: processed.imageUrl,
      published_at: metadata?.pubDate ? new Date(metadata.pubDate).toISOString() : null,
    });

    return {
      url,
      success: true,
      hasContent: (processed.content?.length ?? 0) > 200
    };
  } catch (e: any) {
    const isKnownError = e.message?.includes('Timeout') || e.name === 'TimeoutError' || e.message?.includes('blocked');
    const errorMsg = formatError(e);
    if (isKnownError) {
      console.error(`Crawl failed for ${url}: ${e.message}`);
    } else {
      console.error(`Crawl failed for ${url}: ${errorMsg}`);
    }
    DAO.logError(url, errorMsg, null, '', 'CRAWL', 'Domain-aware crawl phase');
    return { url, success: false, hasContent: false };
  }
}

/**
 * Evaluate existing article with LLM (assumes content already exists in DB)
 * Used by the parallel pipeline for Phase 3
 */
export async function evaluateExistingArticle(url: string): Promise<boolean> {
  try {
    const article = DAO.getArticleByUrl(url);
    if (!article || !article.content || article.content.length < 200) {
      return false;
    }

    // Skip if already evaluated
    if (article.average_score !== null) {
      return true;
    }

    const crawledArticle: CrawledArticle = {
      url: article.resolved_url || article.url,
      originalUrl: article.url,
      title: article.original_title || '',
      content: article.content,
      pubDate: article.published_at || new Date().toISOString(),
      imageUrl: article.image_url || undefined,
    };

    const evaluation = await evaluateArticle(crawledArticle);
    if (!evaluation) return false;

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
      average_score: evaluation.averageScore,
    });

    // Send Discord notification
    await sendDiscordNotification(crawledArticle, evaluation).catch(e =>
      console.error('Discord notification failed:', e.message)
    );

    DAO.clearError(url);
    return true;
  } catch (e: any) {
    const isKnownError = e.message?.includes('Timeout') || e.name === 'TimeoutError';
    const errorMsg = formatError(e);
    if (isKnownError) {
      console.error(`Evaluation failed for ${url}: ${e.message}`);
    } else {
      console.error(`Evaluation failed for ${url}: ${errorMsg}`);
    }
    DAO.logError(url, errorMsg, null, '', 'EVAL', 'Parallel evaluation phase');
    return false;
  }
}

/**
 * Full article processing (crawl + evaluate) - for API endpoints
 * @deprecated Use crawlAndSaveArticle + evaluateExistingArticle for worker pipeline
 */
export async function fullyProcessAndSaveArticle(url: string) {
  let currentPhase = 'CRAWL';
  let currentContext = 'Fetching and parsing article content';
  try {
    // 1. Crawl
    const processed = await processArticle(url);

    // 2. Save Initial
    DAO.saveArticle({
      url: processed.url,
      resolved_url: processed.resolvedUrl,
      original_title: processed.title,
      content: processed.content,
      image_url: processed.imageUrl,
    });

    // 3. Evaluate
    currentPhase = 'EVAL';
    currentContext = 'Analyzing content with AI';
    const articleObj: CrawledArticle = {
      url: processed.resolvedUrl || processed.url,
      title: processed.title,
      content: processed.content,
      originalUrl: url,
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
      resolved_url: processed.resolvedUrl,
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
    DAO.clearError(url);

    return DAO.getArticleByUrl(processed.url);
  } catch (e: any) {
    console.error(`Error in fullyProcessAndSaveArticle for ${url}:`, e.message);
    
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

    DAO.logError(url, humanMessage, e.stack, '', currentPhase, currentContext);
    const error: any = new Error(humanMessage);
    error.phase = currentPhase;
    error.originalError = e.message;
    throw error;
  }
}
