import express from 'express';
import cors from 'cors';
import { DAO } from './lib/db';
import { spawn } from 'child_process';
import path from 'path';
import axios from 'axios';
import { fullyProcessAndSaveArticle } from './lib/crawler/article';

const app = express();
const port = 3005;

let currentWorker: any = null;

app.use(cors());
app.use(express.json());

app.get('/api/articles', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;
  const keyword = req.query.keyword as string;
  const minScore = req.query.minScore ? parseFloat(req.query.minScore as string) : undefined;
  res.json(DAO.getArticles(limit, offset, keyword || '', minScore || 0));
});

app.get('/api/articles/errors', (req, res) => {
  res.json(DAO.getErrors());
});

app.post('/api/articles/ingest', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ message: 'URL is required' });
  try {
    const existing = DAO.getArticleByUrl(url);
    if (existing && existing.average_score !== null) {
      return res.json({ message: 'Article already exists', id: existing.id });
    }
    const article = await fullyProcessAndSaveArticle(url);
    if (!article) return res.status(500).json({ message: 'Failed to ingest' });
    res.json({ message: 'Article ingested', id: (article as any).id, article });
  } catch (e: any) {
    res.status(500).json({ message: 'Ingestion failed', error: e.message });
  }
});

app.post('/api/articles/:id/share', async (req, res) => {
  const articleId = parseInt(req.params.id);
  const article = DAO.getArticleById(articleId);
  const config = DAO.getConfig();
  if (!article || !config.discord_webhook_url) return res.status(400).json({ message: 'Missing article or webhook' });
  try {
    const embed = {
      title: article.translated_title || article.original_title,
      url: article.url,
      description: article.short_summary || article.summary || 'No summary',
      fields: [{
        name: 'Scores',
        value: article.average_score 
          ? `Avg: **${article.average_score.toFixed(2)}**\n(N:${article.score_novelty} I:${article.score_importance} R:${article.score_reliability} C:${article.score_context_value} T:${article.score_thought_provoking})`
          : 'Not scored',
        inline: true
      }],
      color: 0x0078d4,
      image: article.image_url ? { url: article.image_url } : undefined
    };
    await axios.post(config.discord_webhook_url, { embeds: [embed] });
    res.json({ message: 'Shared' });
  } catch (e: any) {
    res.status(500).json({ message: 'Failed to share', error: e.message });
  }
});

app.get('/api/config', (req, res) => res.json(DAO.getConfig()));
app.post('/api/config', (req, res) => { DAO.updateConfig(req.body); res.json({ message: 'Updated' }); });

app.get('/api/characters', (req, res) => res.json(DAO.getCharacters()));
app.post('/api/characters', (req, res) => {
  DAO.addCharacter(req.body.name, req.body.persona, req.body.avatar, req.body.role);
  res.json({ message: 'Added' });
});
app.put('/api/characters/:id', (req, res) => {
  DAO.updateCharacter(parseInt(req.params.id), req.body.name, req.body.persona, req.body.avatar, req.body.role);
  res.json({ message: 'Updated' });
});
app.delete('/api/characters/:id', (req, res) => {
  DAO.deleteCharacter(parseInt(req.params.id));
  res.json({ message: 'Deleted' });
});

app.get('/api/articles/:id/scripts', (req, res) => {
  res.json(DAO.getScriptsForArticle(parseInt(req.params.id)).map(s => ({
    ...s,
    content: JSON.parse(s.content_json || '[]'),
    charA: { name: s.char_a_name, avatar: s.char_a_avatar },
    charB: { name: s.char_b_name, avatar: s.char_b_avatar }
  })));
});

app.post('/api/articles/:id/scripts', async (req, res) => {
  const aid = parseInt(req.params.id);
  const { charAId, charBId } = req.body;
  const art = DAO.getArticleById(aid);
  const cfg = DAO.getConfig();
  const chars = DAO.getCharacters();
  const cA = chars.find(c => c.id === charAId);
  const cB = chars.find(c => c.id === charBId);
  if (!art || !cfg.open_router_api_key || !cA || !cB) return res.status(400).json({ message: 'Missing data' });
  try {
    const lengthMap: Record<string, string> = {
      short: '5-8 lines',
      medium: '10-15 lines',
      long: '20-25 lines'
    };
    const lengthStr = lengthMap[req.body.length] || '10-15 lines';

    const prompt = `Create a dialogue script in Japanese between two characters:
Character A: ${cA.name} (Persona: ${cA.persona})
Character B: ${cB.name} (Persona: ${cB.persona})

Topic: ${art.translated_title || art.original_title}
Content: ${art.summary || (art.content || '').slice(0, 2000)}

Requirements:
- MANDATORY: MUST be a back-and-forth conversation between Character A and Character B.
- Character A acts as the "speaker" value "A".
- Character B acts as the "speaker" value "B".
- Length: approximately ${lengthStr}.
- Tone: Natural and engaging Japanese.
- Output MUST be a valid JSON array of objects.

Output Format:
[
  {"speaker": "A", "text": "Character A's response..."},
  {"speaker": "B", "text": "Character B's response..."},
  ...
]`;

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'google/gemini-2.0-flash-001',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    }, {
      headers: { 'Authorization': `Bearer ${cfg.open_router_api_key}` }
    });
    
    let content = response.data.choices[0].message.content;
    // Basic cleanup of common LLM artifacts
    content = content.replace(/```json\n?|\n?```/g, '').trim();
    
    let scripts: any;
    try {
      scripts = JSON.parse(content);
    } catch (parseError) {
      console.error('Initial JSON parse failed, trying fallback:', content);
      // Brute force attempt to find the array if it's wrapped in markers or text
      const arrayMatch = content.match(/\[\s*\{.*\}\s*\]/s);
      if (arrayMatch) {
        scripts = JSON.parse(arrayMatch[0]);
      } else {
        throw parseError;
      }
    }

    const arr = Array.isArray(scripts) ? scripts : (scripts.script || scripts.dialogue || []);
    
    if (arr.length > 0) {
      DAO.addScript(aid, JSON.stringify(arr), charAId, charBId);
      res.json({ message: 'Generated', script: arr });
    } else {
      throw new Error('Empty script or invalid structure');
    }
  } catch (e: any) {
    console.error('Script generation error:', e);
    res.status(500).json({ message: 'Failed to generate script', error: e.message });
  }
});

app.get('/api/sources', (req, res) => res.json(DAO.getRssSources()));
app.post('/api/sources', (req, res) => { DAO.addRssSource(req.body.url, req.body.name); res.json({ message: 'Added' }); });
app.delete('/api/sources/:id', (req, res) => { DAO.deleteRssSource(parseInt(req.params.id)); res.json({ message: 'Deleted' }); });

app.get('/api/status', (req, res) => {
  const status = DAO.getCrawlerStatus();
  const errors = DAO.getErrors();
  res.json({ ...status, errors });
});

app.post('/api/crawl', (req, res) => {
  const status = DAO.getCrawlerStatus();
  if (status.is_crawling === 1 && status.worker_pid) {
    try {
      process.kill(status.worker_pid, 0); // Check if process exists
      return res.status(400).json({ message: 'A crawl is already in progress' });
    } catch (e) {
      // Process doesn't actually exist despite DB state, continue
      DAO.updateCrawlerStatus({ is_crawling: 0, worker_pid: null });
    }
  }

  const workerPath = path.join(__dirname, 'worker.ts');
  console.log(`Spawning worker at: ${workerPath}`);
  const child = spawn('npx', ['ts-node', workerPath], {
    detached: true,
    stdio: 'ignore'
  });

  child.unref();
  
  if (child.pid) {
    DAO.updateCrawlerStatus({ 
      is_crawling: 1, 
      worker_pid: child.pid,
      current_task: 'Initializing worker...',
      articles_processed: 0,
      last_error: null
    });
    currentWorker = child;
    res.json({ message: 'Started', pid: child.pid });
  } else {
    res.status(500).json({ message: 'Failed to spawn worker' });
  }
});

app.delete('/api/crawl', (req, res) => {
  const status = DAO.getCrawlerStatus();
  if (status.worker_pid) {
    try {
      // Use negative PID to kill the whole process group since it was detached
      process.kill(-status.worker_pid, 'SIGTERM');
    } catch (e) {
      try { process.kill(status.worker_pid, 'SIGTERM'); } catch (e2) {}
    }
  }
  DAO.updateCrawlerStatus({ is_crawling: 0, current_task: 'Stopped', worker_pid: null });
  res.json({ message: 'Stopped' });
});

app.post('/api/articles/:id/retry', async (req, res) => {
  const art = DAO.getArticleById(parseInt(req.params.id));
  if (!art) return res.status(404).json({ message: 'Not found' });
  const upd = await fullyProcessAndSaveArticle(art.url);
  res.json({ message: upd ? 'Success' : 'Failed', article: upd });
});

app.post('/api/errors/:id/retry', async (req, res) => {
  const err = DAO.getErrorById(parseInt(req.params.id));
  if (!err) return res.status(404).json({ message: 'Not found' });
  const upd = await fullyProcessAndSaveArticle(err.url);
  res.json({ message: upd ? 'Success' : 'Failed', article: upd });
});

app.delete('/api/errors/:id', (req, res) => {
  const err = DAO.getErrorById(parseInt(req.params.id));
  if (err) DAO.clearError(err.url);
  res.json({ message: 'Deleted' });
});

const server = app.listen(port, () => console.log(`Backend API at http://localhost:${port}`));

const gracefulShutdown = () => {
  console.log('Shutting down gracefully...');
  const status = DAO.getCrawlerStatus();
  if (status.worker_pid) {
    console.log(`Killing worker PID: ${status.worker_pid}`);
    try { process.kill(-status.worker_pid, 'SIGTERM'); } catch (e) {
      try { process.kill(status.worker_pid, 'SIGTERM'); } catch (e2) {}
    }
  }
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
