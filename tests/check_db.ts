import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH || 'rss_reader.db';
const db = new Database(dbPath);

console.log('--- DB Check ---');
console.log('Database:', dbPath);

// Get sources
const sources = db.prepare('SELECT * FROM rss_sources').all();
console.log('RSS Sources:', JSON.stringify(sources, null, 2));

// Get articles
const articles = db.prepare('SELECT id, original_title, url FROM articles').all();
console.log('Articles:', JSON.stringify(articles, null, 2));

db.close();
