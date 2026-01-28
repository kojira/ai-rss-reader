import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { TextDecoder } from 'util';

export async function processArticle(url: string) {
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      timeout: 15000,
      responseType: 'arraybuffer',
    });

    const buffer = Buffer.from(response.data);
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
