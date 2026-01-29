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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS article_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    title_hint TEXT,
    error_message TEXT,
    stack_trace TEXT,
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

  INSERT OR IGNORE INTO configs (id, score_threshold) VALUES (1, 3.5);
  INSERT OR IGNORE INTO crawler_status (id, is_crawling, articles_processed) VALUES (1, 0, 0);

  INSERT OR IGNORE INTO characters (id, name, persona, role) SELECT 1, 'Expert', 'A smart scholar.', 'expert' WHERE NOT EXISTS (SELECT 1 FROM characters WHERE id = 1);
  INSERT OR IGNORE INTO characters (id, name, persona, role) SELECT 2, 'Learner', 'A curious novice.', 'learner' WHERE NOT EXISTS (SELECT 1 FROM characters WHERE id = 2);
`);

// Migration
try {
    const columns = db.prepare("PRAGMA table_info(articles)").all() as any[];
    const required = [
        'score_novelty', 
        'score_importance', 
        'score_reliability', 
        'score_context_value', 
        'score_thought_provoking'
    ];
    for (const col of required) {
        if (!columns.some(c => c.name === col)) {
            db.exec(`ALTER TABLE articles ADD COLUMN ${col} REAL`);
        }
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
  created_at: string;
}

export interface ArticleError {
  id: number;
  url: string;
  title_hint: string | null;
  error_message: string;
  stack_trace: string | null;
  created_at: string;
}

export class DAO {
  static getCrawlerStatus() {
    return db.prepare('SELECT * FROM crawler_status WHERE id = 1').get() as any;
  }
  static updateCrawlerStatus(status: any) {
    const current = this.getCrawlerStatus();
    const updated = { ...current, ...status };
    db.prepare(`UPDATE crawler_status SET is_crawling = ?, last_run = ?, current_task = ?, articles_processed = ?, last_error = ? WHERE id = 1`).run(updated.is_crawling, updated.last_run, updated.current_task, updated.articles_processed, updated.last_error);
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
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params) as Article[];
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
  static logError(url: string, errorMsg: string, stackTrace: string | null, titleHint?: string) {
    db.prepare('INSERT OR REPLACE INTO article_errors (url, title_hint, error_message, stack_trace) VALUES (?, ?, ?, ?)').run(url, titleHint || '', errorMsg, stackTrace);
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
}
