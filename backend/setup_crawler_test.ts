import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

async function setupTest() {
  const dbPath = path.join(process.cwd(), '..', 'test_rss_reader.db');
  
  // 既存のテストDBがあれば削除
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const db = new Database(dbPath);

  // 本番環境と同じスキーマを適用
  db.exec(`
    CREATE TABLE configs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      open_router_api_key TEXT,
      discord_webhook_url TEXT,
      score_threshold REAL DEFAULT 3.5
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      persona TEXT,
      avatar TEXT,
      role TEXT CHECK(role IN ('expert', 'learner')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rss_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      name TEXT
    );
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      resolved_url TEXT,
      original_title TEXT,
      translated_title TEXT,
      summary TEXT,
      short_summary TEXT,
      content TEXT,
      image_url TEXT,
      average_score REAL,
      score_novelty REAL,
      score_importance REAL,
      score_reliability REAL,
      score_context_value REAL,
      score_thought_provoking REAL,
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE article_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      title_hint TEXT,
      error_message TEXT,
      stack_trace TEXT,
      phase TEXT,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE crawler_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_crawling INTEGER DEFAULT 0,
      last_run DATETIME,
      current_task TEXT,
      articles_processed INTEGER DEFAULT 0,
      last_error TEXT,
      worker_pid INTEGER
    );
    CREATE TABLE scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER,
      content_json TEXT,
      char_a_id INTEGER,
      char_b_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(article_id) REFERENCES articles(id),
      FOREIGN KEY(char_a_id) REFERENCES characters(id),
      FOREIGN KEY(char_b_id) REFERENCES characters(id)
    );
    INSERT INTO configs (id, score_threshold) VALUES (1, 3.5);
    INSERT INTO crawler_status (id, is_crawling, articles_processed) VALUES (1, 0, 0);
  `);

  console.log(`Test DB created at: ${dbPath}`);

  // ダミーのRSSフィードをローカルファイルとして作成
  const rssContent = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
 <title>Test RSS Feed</title>
 <description>A dummy RSS feed for testing the crawler.</description>
 <link>http://localhost:3333/test-rss</link>
 <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
 <pubDate>${new Date().toUTCString()}</pubDate>
 <item>
  <title>Test Article 1</title>
  <description>This is a test article content for the first item.</description>
  <link>https://example.com/test-article-1</link>
  <guid>https://example.com/test-article-1</guid>
  <pubDate>${new Date().toUTCString()}</pubDate>
 </item>
 <item>
  <title>Test Article 2</title>
  <description>Another test article for the crawler to process.</description>
  <link>https://example.com/test-article-2</link>
  <guid>https://example.com/test-article-2</guid>
  <pubDate>${new Date().toUTCString()}</pubDate>
 </item>
</channel>
</rss>`;

  const rssPath = path.join(process.cwd(), '..', 'test_feed.xml');
  fs.writeFileSync(rssPath, rssContent);
  console.log(`Test RSS feed created at: ${rssPath}`);

  // テストDBにRSSソースを追加
  db.prepare('INSERT INTO rss_sources (url, name) VALUES (?, ?)').run(`file://${rssPath}`, 'Test Local Feed');
  
  db.close();
  console.log('Setup complete.');
}

setupTest().catch(console.error);
