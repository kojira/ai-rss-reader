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

export async function processArticle(url: string) {
  try {
    const response = await axios.get(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000,
      responseType: 'arraybuffer',
      validateStatus: (status) => status < 500,
    });

    if (response.status === 404) {
      console.error(`Article not found: ${url}`);
      return null;
    }

    const contentType = response.headers['content-type'] || '';
    const isPdf = contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf');

    const buffer = Buffer.from(response.data);

    if (isPdf) {
      try {
        const data = await pdf(buffer);
        let title = data.info?.Title || '';
        if (!title || title === 'Untitled' || title.trim() === '') {
          // Fallback to filename
          try {
            const parsedUrl = new URL(url);
            title = path.basename(parsedUrl.pathname);
          } catch {
            title = 'PDF Document';
          }
        }

        return {
          title: title,
          content: data.text?.trim() || '',
          imageUrl: '',
          url: (response.request?.res?.responseUrl as string) || url,
        };
      } catch (pdfErr) {
        console.error(`Error parsing PDF ${url}:`, pdfErr);
        return null;
      }
    }

    const decoder = new TextDecoder('utf-8'); // Simplified for now
    const html = decoder.decode(buffer);

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const imageUrl = dom.window.document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
                     dom.window.document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');

    return {
      title: article?.title || '',
      content: article?.textContent?.trim() || '',
      imageUrl: imageUrl || '',
      url: (response.request?.res?.responseUrl as string) || url,
    };
  } catch (e) {
    console.error(`Error processing article ${url}:`, e);
    return null;
  }
}

export async function fullyProcessAndSaveArticle(url: string) {
  // 1. Crawl
  const processed = await processArticle(url);
  if (!processed) return null;

  // 2. Save Initial
  DAO.saveArticle({
    url: processed.url,
    original_title: processed.title,
    content: processed.content,
    image_url: processed.imageUrl,
  });

  // 3. Evaluate
  const articleObj: CrawledArticle = {
    url: processed.url,
    title: processed.title,
    content: processed.content,
    originalUrl: url,
    pubDate: new Date().toISOString(),
    imageUrl: processed.imageUrl
  };

  const evaluation = await evaluateArticle(articleObj);

  if (evaluation) {
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
    await sendDiscordNotification(articleObj, evaluation);
  }

  return DAO.getArticleByUrl(processed.url);
}
