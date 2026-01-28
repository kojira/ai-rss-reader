import express from 'express';
import cors from 'cors';
import { DAO } from './lib/db';
import { exec } from 'child_process';
import path from 'path';
import axios from 'axios';
import { fullyProcessAndSaveArticle } from './lib/crawler/article';

const app = express();
const port = 3005;

app.use(cors());
app.use(express.json());

// Articles
app.get('/api/articles', (req, res) => {
  res.json(DAO.getArticles(100));
});

app.post('/api/articles/ingest', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ message: 'URL is required' });
  }

  try {
    // Check if exists
    const existing = DAO.getArticleByUrl(url);
    if (existing && existing.average_score !== null) {
      return res.json({ message: 'Article already exists', id: existing.id });
    }

    // Process article fully
    const article = await fullyProcessAndSaveArticle(url);
    if (!article) {
      return res.status(500).json({ message: 'Failed to ingest article' });
    }

    res.json({ message: 'Article ingested', id: article.id, article });
  } catch (e: any) {
    console.error('Ingestion failed:', e);
    res.status(500).json({ message: 'Ingestion failed', error: e.message });
  }
});

app.post('/api/articles/:id/share', async (req, res) => {
  const articleId = parseInt(req.params.id);
  const article = DAO.getArticleById(articleId);
  const config = DAO.getConfig();

  if (!article) {
    return res.status(404).json({ message: 'Article not found' });
  }

  if (!config.discord_webhook_url) {
    return res.status(400).json({ message: 'Discord webhook URL not configured' });
  }

  try {
    const embed = {
      title: article.translated_title || article.original_title,
      url: article.url,
      description: article.short_summary || article.summary || 'No summary available',
      fields: [
        {
          name: 'Scores',
          value: article.average_score 
            ? `Avg: **${article.average_score.toFixed(2)}**\n(N:${article.score_novelty} I:${article.score_importance} R:${article.score_reliability} C:${article.score_context_value} T:${article.score_thought_provoking})`
            : 'Not scored',
          inline: true
        }
      ],
      color: 0x0078d4, // A different color for manual share if desired
      timestamp: new Date().toISOString(),
      image: article.image_url ? { url: article.image_url } : undefined
    };

    await axios.post(config.discord_webhook_url, {
      embeds: [embed]
    });
    res.json({ message: 'Shared to Discord' });
  } catch (e: any) {
    console.error('Manual Discord share failed:', e);
    res.status(500).json({ message: 'Failed to share to Discord', error: e.message });
  }
});

// Config
app.get('/api/config', (req, res) => {
  res.json(DAO.getConfig());
});

app.post('/api/config', (req, res) => {
  DAO.updateConfig(req.body);
  res.json({ message: 'Config updated' });
});

// Characters
app.get('/api/characters', (req, res) => {
  res.json(DAO.getCharacters());
});

app.post('/api/characters', (req, res) => {
  const { name, persona, avatar, role } = req.body;
  DAO.addCharacter(name, persona, avatar, role);
  res.json({ message: 'Character added' });
});

app.put('/api/characters/:id', (req, res) => {
  const { name, persona, avatar, role } = req.body;
  DAO.updateCharacter(parseInt(req.params.id), name, persona, avatar, role);
  res.json({ message: 'Character updated' });
});

app.delete('/api/characters/:id', (req, res) => {
  DAO.deleteCharacter(parseInt(req.params.id));
  res.json({ message: 'Character deleted' });
});

// Dialogue Scripts
app.get('/api/articles/:id/scripts', (req, res) => {
  const scripts = DAO.getScriptsForArticle(parseInt(req.params.id));
  res.json(scripts.map(s => ({ 
    ...s, 
    content: JSON.parse(s.content_json),
    charA: { name: s.char_a_name, avatar: s.char_a_avatar },
    charB: { name: s.char_b_name, avatar: s.char_b_avatar }
  })));
});

app.post('/api/articles/:id/scripts', async (req, res) => {
  const articleId = parseInt(req.params.id);
  const { charAId, charBId } = req.body;
  const article = DAO.getArticleById(articleId);
  const config = DAO.getConfig();
  const characters = DAO.getCharacters();
  
  const charA = characters.find(c => c.id === charAId);
  const charB = characters.find(c => c.id === charBId);

  if (!article || !config.open_router_api_key || !charA || !charB) {
    return res.status(400).json({ message: 'Missing article, API key, or characters' });
  }

  try {
    const { length = 'medium' } = req.body;
    
    let lengthInstruction = "";
    if (length === "short") {
      lengthInstruction = "Make it very brief, approximately 4-6 lines in total. Provide a quick overview.";
    } else if (length === "long") {
      lengthInstruction = "Make it a deep dive, at least 20 lines long. Include multiple follow-up questions from the learner, detailed explanations from the expert, and an extensive discussion on the implications.";
    } else {
      lengthInstruction = "Make it a standard detailed explanation, approximately 10-15 lines long. Cover the main points and a couple of follow-up questions.";
    }

    const prompt = `
      You are an AI script writer. Based on the following news article, create a dialogue script between two characters:
      
      Character A (Expert): Name="${charA.name}", Persona="${charA.persona}"
      Character B (Learner): Name="${charB.name}", Persona="${charB.persona}"
      
      Length Requirement: ${lengthInstruction}

      Structure:
      - B starts by asking a question about the news.
      - A explains the key points.
      - B asks follow-up or clarifying questions.
      - A answers in detail but simply.
      - They wrap up with a summary or opinion.
      
      Article Title: ${article.original_title}
      Article Content: ${article.content}
      
      Output ONLY a JSON array of objects with "speaker" (either "A" or "B") and "text" (in Japanese).
      Example: [{"speaker": "B", "text": "..."}, {"speaker": "A", "text": "..."}]
    `;

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'google/gemini-2.0-flash-001',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    }, {
      headers: { 'Authorization': `Bearer ${config.open_router_api_key}`, 'Content-Type': 'application/json' }
    });

    const content = response.data.choices[0].message.content;
    let scriptArray = [];
    try {
        const parsed = JSON.parse(content);
        scriptArray = Array.isArray(parsed) ? parsed : (parsed.script || parsed.dialogue || []);
    } catch (e) {
        scriptArray = [];
    }

    if (scriptArray.length > 0) {
      DAO.addScript(articleId, JSON.stringify(scriptArray), charAId, charBId);
      res.json({ message: 'Script generated', script: scriptArray });
    } else {
      throw new Error('Failed to parse script JSON');
    }
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ message: 'Failed to generate script', error: e.message });
  }
});

// Sources (omitted for brevity in logic but fully implemented in DAO)
app.get('/api/sources', (req, res) => res.json(DAO.getRssSources()));
app.post('/api/sources', (req, res) => { DAO.addRssSource(req.body.url, req.body.name); res.json({ message: 'Source added' }); });
app.delete('/api/sources/:id', (req, res) => { DAO.deleteRssSource(parseInt(req.params.id)); res.json({ message: 'Source deleted' }); });

// Status & Controls
app.get('/api/status', (req, res) => res.json(DAO.getCrawlerStatus()));
app.post('/api/crawl', (req, res) => {
  const status = DAO.getCrawlerStatus();
  if (status.is_crawling === 1) return res.status(400).json({ message: 'Already crawling' });
  const workerPath = path.join(__dirname, 'worker.ts');
  exec(`npx ts-node ${workerPath}`, (error) => { if (error) DAO.updateCrawlerStatus({ last_error: error.message, is_crawling: 0 }); });
  res.json({ message: 'Crawl started' });
});
app.delete('/api/crawl', (req, res) => {
  exec("pkill -9 -f 'ts-node.*worker.ts'");
  DAO.updateCrawlerStatus({ is_crawling: 0, current_task: 'Stopped' });
  res.json({ message: 'Crawl stopped' });
});

app.listen(port, () => console.log(`Backend API at http://localhost:${port}`));
