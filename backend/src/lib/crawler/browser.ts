import { chromium, Browser } from 'playwright';
import { DAO } from '../db/index';

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  // ブラウザが存在しないか、閉じられている場合は再起動
  if (!browserInstance || !browserInstance.isConnected()) {
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch { /* Browser may already be closed */ }
    }
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    });
  }
  return browserInstance;
}

// ボット検出を回避するためのスクリプト
const stealthScript = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = { runtime: {} };
`;

export async function fetchFinalUrl(url: string, timeoutMs: number = 30000): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const browser = await getBrowser();
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
        await page.waitForTimeout(3000);
        return page.url();
      } finally {
        await page.close();
        await context.close();
      }
    } catch (e: any) {
      if (attempt === 0 && e.message?.includes('has been closed')) {
        console.log('[Browser] Browser closed, restarting...');
        browserInstance = null;
        continue;
      }
      const isKnownError = e.message?.includes('Timeout') || e.name === 'TimeoutError';
      if (isKnownError) {
        console.error(`Browser fetch failed for ${url}: ${e.message}`);
      } else {
        const errorMsg = e.isAxiosError ? `${e.message}${e.cause?.message ? ` [${e.cause.message}]` : ''}` : (e.message || String(e));
        console.error(`Browser fetch failed for ${url}: ${errorMsg}`);
      }
      return url;
    }
  }
  return url;
}

export async function fetchWithBrowser(url: string, timeoutMs: number = 45000): Promise<{ html: string; finalUrl: string }> {
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  for (let attempt = 0; attempt < 2; attempt++) {
    let context: any = null;
    let page: any = null;
    try {
      const browser = await getBrowser();
      context = await browser.newContext({
        userAgent,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        viewport: { width: 1920, height: 1080 },
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
      });
      page = await context.newPage();

      // ボット検出回避スクリプトを注入
      await page.addInitScript(stealthScript);

      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });

      // クッキー同意ボタンを探してクリック
      const consentSelectors = [
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[class*="consent"]',
        'button[id*="consent"]',
        '[data-testid*="accept"]',
        '.didomi-continue-without-agreeing',
        '#onetrust-accept-btn-handler',
      ];
      for (const selector of consentSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            await btn.click();
            await page.waitForTimeout(1000);
            break;
          }
        } catch { /* Cookie consent button may not exist */ }
      }

      // ページをスクロールしてlazyコンテンツをロード
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.waitForTimeout(2000);

      const html = await page.content();
      const finalUrl = page.url();

      // デバッグ: タイトルと本文の長さを出力
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      console.log(`[Playwright] URL: ${finalUrl}, Title: ${titleMatch?.[1]?.slice(0, 50)}, HTML length: ${html.length}`);

      // ボット検出サービスのチェック
      const botDetectionPatterns = [
        { pattern: /captcha-delivery\.com|DataDome/i, name: 'DataDome' },
        { pattern: /challenges\.cloudflare\.com/i, name: 'Cloudflare' },
        { pattern: /px-captcha|perimeterx/i, name: 'PerimeterX' },
        { pattern: /distil_r_blocked|distilnetworks/i, name: 'Distil' },
        { pattern: /<title>Access Denied<\/title>/i, name: 'Akamai' },
      ];

      for (const { pattern, name } of botDetectionPatterns) {
        if (pattern.test(html)) {
          const domain = new URL(finalUrl).hostname;
          console.log(`[Playwright] ${name} bot protection detected on ${domain}, adding to blocklist`);
          DAO.addBlockedDomain(domain, `${name} bot protection`);
          throw new Error(`Bot protection (${name}) detected, domain added to blocklist: ${domain}`);
        }
      }

      // 短いHTMLの場合は内容を出力（ボット検出の確認用）
      if (html.length < 5000) {
        console.log(`[Playwright] Short HTML detected, content:\n${html.slice(0, 2000)}`);
      }

      return { html, finalUrl };
    } catch (e: any) {
      if (attempt === 0 && e.message?.includes('has been closed')) {
        console.log('[Browser] Browser closed, restarting...');
        browserInstance = null;
        continue;
      }
      throw e;
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }
  throw new Error('Failed to fetch with browser after retries');
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
