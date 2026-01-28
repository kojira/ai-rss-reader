import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'rss_reader.db');
const db = new Database(dbPath);

// Initialize Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    open_router_api_key TEXT,
    discord_webhook_url TEXT,
    score_threshold REAL DEFAULT 3.5
  );

  CREATE TABLE IF NOT EXISTS rss_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    original_title TEXT,
    translated_title TEXT,
    summary TEXT,
    short_summary TEXT,
    content TEXT,
    score_novelty INTEGER,
    score_importance INTEGER,
    score_reliability INTEGER,
    score_context_value INTEGER,
    score_thought_provoking INTEGER,
    average_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crawler_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    is_crawling INTEGER DEFAULT 0,
    last_run DATETIME,
    current_task TEXT,
    articles_processed INTEGER DEFAULT 0,
    last_error TEXT
  );

  -- Initial status if not exists
  INSERT OR IGNORE INTO crawler_status (id, is_crawling, articles_processed) VALUES (1, 0, 0);

  -- Initial config if not exists
  INSERT OR IGNORE INTO configs (id, score_threshold) VALUES (1, 3.5);
`);

export default db;

export interface Config {
  open_router_api_key: string | null;
  discord_webhook_url: string | null;
  score_threshold: number;
}

export interface RssSource {
  id: number;
  url: string;
  name: string;
}

export interface Article {
  id: number;
  url: string;
  original_title: string;
  translated_title: string | null;
  summary: string | null;
  short_summary: string | null;
  content: string | null;
  score_novelty: number | null;
  score_importance: number | null;
  score_reliability: number | null;
  score_context_value: number | null;
  score_thought_provoking: number | null;
  average_score: number | null;
  created_at: string;
}

export class DAO {
  static getCrawlerStatus(): { is_crawling: number, last_run: string | null, current_task: string | null, articles_processed: number, last_error: string | null } {
    const status = db.prepare('SELECT * FROM crawler_status WHERE id = 1').get() as any;
    if (!status) {
      db.prepare('INSERT INTO crawler_status (id, is_crawling, articles_processed) VALUES (1, 0, 0)').run();
      return { is_crawling: 0, last_run: null, current_task: null, articles_processed: 0, last_error: null };
    }
    return status;
  }

  static updateCrawlerStatus(status: Partial<{ is_crawling: number, last_run: string, current_task: string, articles_processed: number, last_error: string | null }>) {
    try {
      const current = this.getCrawlerStatus();
      const updated = { ...current, ...status };
      db.prepare(`
        UPDATE crawler_status 
        SET is_crawling = ?, last_run = ?, current_task = ?, articles_processed = ?, last_error = ?
        WHERE id = 1
      `).run(updated.is_crawling, updated.last_run, updated.current_task, updated.articles_processed, updated.last_error);
    } catch (e) {
      console.error('Failed to update crawler status in DB:', e);
    }
  }

  static getConfig(): Config {
    return db.prepare('SELECT * FROM configs WHERE id = 1').get() as Config;
  }

  static updateConfig(config: Partial<Config>) {
    const current = this.getConfig();
    const updated = { ...current, ...config };
    db.prepare(`
      UPDATE configs 
      SET open_router_api_key = ?, discord_webhook_url = ?, score_threshold = ?
      WHERE id = 1
    `).run(updated.open_router_api_key, updated.discord_webhook_url, updated.score_threshold);
  }

  static getRssSources(): RssSource[] {
    return db.prepare('SELECT * FROM rss_sources').all() as RssSource[];
  }

  static addRssSource(url: string, name: string) {
    return db.prepare('INSERT OR IGNORE INTO rss_sources (url, name) VALUES (?, ?)').run(url, name);
  }

  static deleteRssSource(id: number) {
    return db.prepare('DELETE FROM rss_sources WHERE id = ?').run(id);
  }

  static getUnprocessedArticles(limit = 20): Article[] {
    return db.prepare('SELECT * FROM articles WHERE average_score IS NULL ORDER BY created_at ASC LIMIT ?').all(limit) as Article[];
  }

  static getArticles(limit = 50): Article[] {
    return db.prepare('SELECT * FROM articles ORDER BY created_at DESC LIMIT ?').all(limit) as Article[];
  }

  static getArticleByUrl(url: string): Article | undefined {
    return db.prepare('SELECT * FROM articles WHERE url = ?').get(url) as Article | undefined;
  }

  static saveArticle(article: Partial<Article>) {
    const columns = Object.keys(article).join(', ');
    const placeholders = Object.keys(article).map(() => '?').join(', ');
    const values = Object.values(article);
    
    return db.prepare(`
      INSERT INTO articles (${columns}) 
      VALUES (${placeholders})
      ON CONFLICT(url) DO UPDATE SET
        translated_title = excluded.translated_title,
        summary = excluded.summary,
        short_summary = excluded.short_summary,
        score_novelty = excluded.score_novelty,
        score_importance = excluded.score_importance,
        score_reliability = excluded.score_reliability,
        score_context_value = excluded.score_context_value,
        score_thought_provoking = excluded.score_thought_provoking,
        average_score = excluded.average_score
    `).run(...values);
  }
}
