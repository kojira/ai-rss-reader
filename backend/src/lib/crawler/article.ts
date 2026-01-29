import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { TextDecoder } from 'util';
import pdf from 'pdf-parse';
import path from 'path';
import { DAO } from '../db';
import { evaluateArticle } from '../llm/evaluator';
import { sendDiscordNotification } from '../notifier/discord';
import { CrawledArticle } from '../types';
import { fetchFinalUrl } from './browser';

function isGoogleNewsUrl(url: string): boolean {
  return url.includes('news.google.com') || url.includes('news.url.google.com') || url.includes('google.com/url');
}

export async function processArticle(url: string) {
  let targetUrl = url;
  
  if (isGoogleNewsUrl(url)) {
    console.log(`Google News URL detected, resolving redirect: ${url}`);
    try {
      targetUrl = await fetchFinalUrl(url);
      console.log(`Resolved to: ${targetUrl}`);
    } catch (e: any) {
      console.error(`Failed to resolve Google News URL: ${e.message}`);
      // Continue with original URL as fallback, though likely to fail
    }
  }

  try {
    const response = await axios.get(targetUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000,
      responseType: 'arraybuffer',
      validateStatus: (status) => status < 500,
    });

    if (response.status === 404) {
      throw new Error(`Article not found (404): ${targetUrl}`);
    }

    if (response.status >= 400) {
      throw new Error(`Failed to fetch article: ${response.status} ${targetUrl}`);
    }

    const contentType = response.headers['content-type'] || '';
    const isPdf = contentType.includes('application/pdf') || targetUrl.toLowerCase().endsWith('.pdf');

    const buffer = Buffer.from(response.data);

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
        url: (response.request?.res?.responseUrl as string) || targetUrl,
      };
    }

    const decoder = new TextDecoder('utf-8');
    let html = decoder.decode(buffer);

    // YouTube handling (basic meta tag capture if transcripts unavailable)
    if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
      const dom = new JSDOM(html, { url: targetUrl });
      const title = dom.window.document.querySelector('title')?.textContent || '';
      const description = dom.window.document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
      
      if (title && description) {
        return {
          title,
          content: `YouTube Video: ${title}\n\nDescription:\n${description}`,
          imageUrl: dom.window.document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '',
          url: (response.request?.res?.responseUrl as string) || targetUrl,
        };
      }
    }

    const dom = new JSDOM(html, { url: targetUrl });
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
      url: (response.request?.res?.responseUrl as string) || targetUrl,
    };
  } catch (e: any) {
    console.error(`Error processing article ${targetUrl}:`, e.message);
    throw e;
  }
}

export async function fullyProcessAndSaveArticle(url: string) {
  let currentPhase = 'CRAWL';
  let currentContext = 'Fetching and parsing article content';
  try {
    // 1. Crawl
    const processed = await processArticle(url);

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
