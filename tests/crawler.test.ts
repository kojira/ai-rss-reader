import { DAO } from '../backend/src/lib/db/index';
import { crawlAllFeeds } from '../backend/src/lib/crawler/rss';
import * as fs from 'fs';
import * as path from 'path';

async function runTest() {
  const testDbPath = path.join(__dirname, 'test_rss_reader.db');
  const testFeedPath = path.join(__dirname, 'test_feed.xml');

  console.log('--- Crawler Test Start ---');
  console.log('Using DB:', testDbPath);
  console.log('Using Feed:', testFeedPath);

  // 1. 環境変数の設定 (DAOがこれを読み込む)
  process.env.DB_PATH = testDbPath;

  // 2. テスト用RSSフィードの作成
  // linkを実在する（取得可能な）サイトにするか、processArticleをモックする必要があるが、
  // ここでは実際の挙動を見たいので、取得可能なURLを使用する。
  const rssContent = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
 <title>Test RSS Feed</title>
 <item>
  <title>Test Article ${Date.now()}</title>
  <description>Test content for article.</description>
  <link>https://example.com/</link>
  <pubDate>${new Date().toUTCString()}</pubDate>
 </item>
</channel>
</rss>`;
  fs.writeFileSync(testFeedPath, rssContent);

  // 3. テストDBの初期化
  const sources = DAO.getRssSources();
  for (const s of sources) {
    DAO.deleteRssSource(s.id);
  }
  DAO.addRssSource(`file://${testFeedPath}`, 'Test Feed');

  // 4. クロール実行
  console.log('Running crawlAllFeeds()...');
  await crawlAllFeeds();

  // 5. 結果確認
  const articles = DAO.getArticles();
  console.log('--- Test Results ---');
  console.log('Articles in DB:', articles.length);
  articles.forEach(a => {
    console.log(`- [${a.id}] ${a.original_title} (${a.url})`);
  });

  if (articles.length > 0) {
    console.log('SUCCESS: Article found in test database.');
  } else {
    console.log('FAILURE: No articles found.');
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
