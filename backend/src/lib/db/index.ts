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

  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    persona TEXT,
    avatar TEXT,
    role TEXT CHECK(role IN ('expert', 'learner')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rss_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS articles (
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

  CREATE TABLE IF NOT EXISTS article_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    title_hint TEXT,
    error_message TEXT,
    stack_trace TEXT,
    phase TEXT,
    context TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crawler_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    is_crawling INTEGER DEFAULT 0,
    last_run DATETIME,
    current_task TEXT,
    articles_processed INTEGER DEFAULT 0,
    last_error TEXT,
    worker_pid INTEGER
  );

  CREATE TABLE IF NOT EXISTS scripts (
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

  CREATE TABLE IF NOT EXISTS blocked_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT UNIQUE,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO configs (id, score_threshold) VALUES (1, 3.5);
  INSERT OR IGNORE INTO crawler_status (id, is_crawling, articles_processed) VALUES (1, 0, 0);

  INSERT OR IGNORE INTO characters (id, name, persona, role) SELECT 1, 'Expert', 'A smart scholar.', 'expert' WHERE NOT EXISTS (SELECT 1 FROM characters WHERE id = 1);
  INSERT OR IGNORE INTO characters (id, name, persona, role) SELECT 2, 'Learner', 'A curious novice.', 'learner' WHERE NOT EXISTS (SELECT 1 FROM characters WHERE id = 2);
`);

// Migration
try {
    const columns = db.prepare("PRAGMA table_info(articles)").all() as any[];
    const required = [
        'resolved_url',
        'score_novelty', 
        'score_importance', 
        'score_reliability', 
        'score_context_value', 
        'score_thought_provoking',
        'published_at'
    ];
    for (const col of required) {
        if (!columns.some(c => c.name === col)) {
            const type = (col === 'resolved_url' || col === 'published_at') ? 'TEXT' : 'REAL';
            db.exec(`ALTER TABLE articles ADD COLUMN ${col} ${type}`);
        }
    }
    const errorColumns = db.prepare("PRAGMA table_info(article_errors)").all() as any[];
    if (!errorColumns.some(c => c.name === 'phase')) {
        db.exec("ALTER TABLE article_errors ADD COLUMN phase TEXT");
    }
    if (!errorColumns.some(c => c.name === 'context')) {
        db.exec("ALTER TABLE article_errors ADD COLUMN context TEXT");
    }
    const statusColumns = db.prepare("PRAGMA table_info(crawler_status)").all() as any[];
    if (!statusColumns.some(c => c.name === 'worker_pid')) {
        db.exec("ALTER TABLE crawler_status ADD COLUMN worker_pid INTEGER");
    }
} catch (e) {}

export default db;

export interface Config {
  id: number;
  open_router_api_key: string | null;
  discord_webhook_url: string | null;
  score_threshold: number;
}

export interface Character {
  id: number;
  name: string;
  persona: string;
  avatar: string | null;
  role: 'expert' | 'learner';
  created_at: string;
}

export interface Article {
  id: number;
  url: string;
  resolved_url: string | null;
  original_title: string;
  translated_title: string | null;
  summary: string | null;
  short_summary: string | null;
  content: string | null;
  image_url: string | null;
  average_score: number | null;
  score_novelty: number | null;
  score_importance: number | null;
  score_reliability: number | null;
  score_context_value: number | null;
  score_thought_provoking: number | null;
  published_at: string | null;
  created_at: string;
}

export interface ArticleError {
  id: number;
  url: string;
  title_hint: string | null;
  error_message: string;
  stack_trace: string | null;
  phase: string | null;
  context: string | null;
  created_at: string;
}

export class DAO {
  static getCrawlerStatus() {
    return db.prepare('SELECT * FROM crawler_status WHERE id = 1').get() as any;
  }
  static updateCrawlerStatus(status: any) {
    const current = this.getCrawlerStatus() || { 
      is_crawling: 0, 
      last_run: null, 
      current_task: 'Idle', 
      articles_processed: 0, 
      last_error: null, 
      worker_pid: null 
    };
    // Only update fields provided in the status object, keeping others intact
    const updated = { 
      is_crawling: status.is_crawling !== undefined ? status.is_crawling : current.is_crawling,
      last_run: status.last_run !== undefined ? status.last_run : current.last_run,
      current_task: status.current_task !== undefined ? status.current_task : current.current_task,
      articles_processed: status.articles_processed !== undefined ? status.articles_processed : current.articles_processed,
      last_error: status.last_error !== undefined ? status.last_error : current.last_error,
      worker_pid: status.worker_pid !== undefined ? status.worker_pid : current.worker_pid
    };
    
    db.prepare(`UPDATE crawler_status SET is_crawling = ?, last_run = ?, current_task = ?, articles_processed = ?, last_error = ?, worker_pid = ? WHERE id = 1`)
      .run(updated.is_crawling, updated.last_run, updated.current_task, updated.articles_processed, updated.last_error, updated.worker_pid);
  }
  static resetCrawlerStatus(task = 'Idle') {
    db.prepare(`UPDATE crawler_status SET is_crawling = 0, current_task = ?, worker_pid = NULL WHERE id = 1`)
      .run(task);
  }
  static getConfig(): Config {
    return db.prepare('SELECT * FROM configs WHERE id = 1').get() as Config;
  }
  static updateConfig(config: Partial<Config>) {
    const current = this.getConfig();
    const updated = { ...current, ...config };
    db.prepare(`UPDATE configs SET open_router_api_key = ?, discord_webhook_url = ?, score_threshold = ? WHERE id = 1`).run(updated.open_router_api_key, updated.discord_webhook_url, updated.score_threshold);
  }
  static getArticles(limit = 20, offset = 0, keyword = '', minScore = 0): Article[] {
    let sql = 'SELECT * FROM articles WHERE 1=1';
    const params: any[] = [];
    if (keyword) {
      sql += ' AND (original_title LIKE ? OR translated_title LIKE ? OR summary LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (minScore > 0) {
      sql += ' AND average_score >= ?';
      params.push(minScore);
    }
    sql += ' ORDER BY CASE WHEN published_at IS NOT NULL AND published_at != \'\' THEN published_at ELSE created_at END DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const articles = db.prepare(sql).all(...params) as Article[];
    return this.filterBlockedDomains(articles);
  }
  static getArticleById(id: number): Article | undefined {
    return db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article | undefined;
  }
  static getArticleByUrl(url: string): Article | undefined {
    return db.prepare('SELECT * FROM articles WHERE url = ?').get(url) as Article | undefined;
  }
  static saveArticle(article: Partial<Article>) {
    const keys = Object.keys(article);
    const columns = keys.join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const values = Object.values(article);
    const updates = keys.filter(k => k !== 'url').map(k => `${k}=excluded.${k}`).join(', ');
    return db.prepare(`INSERT INTO articles (${columns}) VALUES (${placeholders}) ON CONFLICT(url) DO UPDATE SET ${updates}`).run(...values);
  }
  static logError(url: string, errorMsg: string, stackTrace: string | null, titleHint?: string, phase?: string, context?: string) {
    db.prepare('INSERT OR REPLACE INTO article_errors (url, title_hint, error_message, stack_trace, phase, context) VALUES (?, ?, ?, ?, ?, ?)').run(url, titleHint || '', errorMsg, stackTrace, phase || null, context || null);
  }
  static getErrors(): ArticleError[] {
    return db.prepare('SELECT * FROM article_errors ORDER BY created_at DESC LIMIT 50').all() as ArticleError[];
  }
  static getErrorById(id: number): ArticleError | undefined {
    return db.prepare('SELECT * FROM article_errors WHERE id = ?').get(id) as ArticleError | undefined;
  }
  static clearError(url: string) {
    db.prepare('DELETE FROM article_errors WHERE url = ?').run(url);
  }
  static getRssSources() {
    return db.prepare('SELECT * FROM rss_sources').all() as any[];
  }
  static addRssSource(url: string, name: string) {
    return db.prepare('INSERT INTO rss_sources (url, name) VALUES (?, ?)').run(url, name);
  }
  static deleteRssSource(id: number) {
    return db.prepare('DELETE FROM rss_sources WHERE id = ?').run(id);
  }
  static getCharacters(): Character[] {
    return db.prepare('SELECT * FROM characters').all() as Character[];
  }
  static addCharacter(name: string, persona: string, avatar: string|null, role: string) {
    return db.prepare('INSERT INTO characters (name, persona, avatar, role) VALUES (?, ?, ?, ?)').run(name, persona, avatar, role);
  }
  static updateCharacter(id: number, name: string, persona: string, avatar: string|null, role: string) {
    return db.prepare('UPDATE characters SET name=?, persona=?, avatar=?, role=? WHERE id=?').run(name, persona, avatar, role, id);
  }
  static deleteCharacter(id: number) {
    return db.prepare('DELETE FROM characters WHERE id=?').run(id);
  }
  static getScriptsForArticle(id: number): any[] {
    return db.prepare('SELECT s.*, ca.name as char_a_name, ca.avatar as char_a_avatar, cb.name as char_b_name, cb.avatar as char_b_avatar FROM scripts s LEFT JOIN characters ca ON s.char_a_id = ca.id LEFT JOIN characters cb ON s.char_b_id = cb.id WHERE article_id = ? ORDER BY created_at DESC').all(id);
  }
  static addScript(aid: number, json: string, caid: number, cbid: number) {
    return db.prepare('INSERT INTO scripts (article_id, content_json, char_a_id, char_b_id) VALUES (?, ?, ?, ?)').run(aid, json, caid, cbid);
  }
  static getUnprocessedArticles(limit = 10): Article[] {
    const articles = db.prepare('SELECT * FROM articles WHERE average_score IS NULL OR length(content) < 200 ORDER BY created_at DESC LIMIT ?').all(limit) as Article[];
    return this.filterBlockedDomains(articles);
  }
  static getArticlesWithoutImages(limit = 100): Article[] {
    const articles = db.prepare('SELECT * FROM articles WHERE image_url IS NULL OR image_url = \'\' ORDER BY created_at DESC LIMIT ?').all(limit) as Article[];
    return this.filterBlockedDomains(articles);
  }
  // ブロック済みドメインの記事を除外するヘルパー
  private static filterBlockedDomains(articles: Article[]): Article[] {
    const blockedDomains = this.getBlockedDomains().map(d => d.domain);
    if (blockedDomains.length === 0) return articles;

    return articles.filter(article => {
      const urlToCheck = article.resolved_url || article.url;
      try {
        const domain = new URL(urlToCheck).hostname;
        return !blockedDomains.includes(domain);
      } catch {
        return true;
      }
    });
  }

  // ブロックリスト関連
  static getBlockedDomains(): { id: number; domain: string; reason: string; created_at: string }[] {
    return db.prepare('SELECT * FROM blocked_domains ORDER BY created_at DESC').all() as any[];
  }
  static isBlockedDomain(domain: string): boolean {
    const result = db.prepare('SELECT 1 FROM blocked_domains WHERE domain = ?').get(domain);
    return !!result;
  }
  static addBlockedDomain(domain: string, reason: string) {
    return db.prepare('INSERT OR IGNORE INTO blocked_domains (domain, reason) VALUES (?, ?)').run(domain, reason);
  }
  static removeBlockedDomain(id: number) {
    return db.prepare('DELETE FROM blocked_domains WHERE id = ?').run(id);
  }
}
