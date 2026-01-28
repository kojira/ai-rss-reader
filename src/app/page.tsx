'use client';

import React, { useEffect, useState } from 'react';
import { 
  AppBar, Toolbar, Typography, Container, Grid, Card, CardContent, CardActions, 
  Button, IconButton, Dialog, DialogTitle, DialogContent, Box, Chip, Divider,
  TextField, List, ListItem, ListItemText, ListItemSecondaryAction
} from '@mui/material';
// @ts-ignore
const GridItem = (props: any) => <Grid {...props} />;
import { Refresh, Settings, OpenInNew, Delete, Add } from '@mui/icons-material';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';

interface Article {
  id: number;
  url: string;
  original_title: string;
  translated_title: string;
  summary: string;
  short_summary: string;
  average_score: number;
  score_novelty: number;
  score_importance: number;
  score_reliability: number;
  score_context_value: number;
  score_thought_provoking: number;
  created_at: string;
}

interface CrawlerStatus {
  isCrawling: boolean;
  lastRun: string | null;
  currentTask: string | null;
  articlesProcessed: number;
  lastError: string | null;
}

interface Config {
  open_router_api_key: string;
  discord_webhook_url: string;
  score_threshold: number;
}

interface Source {
  id: number;
  url: string;
  name: string;
}

export default function Home() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState<CrawlerStatus>({ isCrawling: false, lastRun: null, currentTask: null, articlesProcessed: 0 });
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');

  const fetchData = async () => {
    const [artRes, confRes, sourRes, statRes] = await Promise.all([
      fetch('/api/articles'),
      fetch('/api/config'),
      fetch('/api/sources'),
      fetch('/api/status')
    ]);
    setArticles(await artRes.json());
    setConfig(await confRes.json());
    setSources(await sourRes.json());
    setStatus(await statRes.json());
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const triggerCrawl = async () => {
    // Optimistically set UI to crawling
    setStatus(prev => ({ ...prev, isCrawling: true, currentTask: 'Starting process...' }));
    await fetch('/api/crawl', { method: 'POST' });
    // Fetches will update the rest
    fetchData();
  };

  const saveConfig = async () => {
    if (!config) return;
    await fetch('/api/config', {
      method: 'POST',
      body: JSON.stringify(config),
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const addSource = async () => {
    await fetch('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ url: newSourceUrl, name: newSourceName }),
      headers: { 'Content-Type': 'application/json' }
    });
    setNewSourceUrl('');
    setNewSourceName('');
    fetchData();
  };

  const deleteSource = async (id: number) => {
    await fetch('/api/sources', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' }
    });
    fetchData();
  };

  const getRadarData = (article: Article) => [
    { subject: 'Novelty', A: article.score_novelty },
    { subject: 'Importance', A: article.score_importance },
    { subject: 'Reliability', A: article.score_reliability },
    { subject: 'Context', A: article.score_context_value },
    { subject: 'Thinking', A: article.score_thought_provoking },
  ];

  return (
    <Box sx={{ flexGrow: 1, bgcolor: '#f5f5f5', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>AI RSS Reader</Typography>
          <Box sx={{ mr: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            {status.lastError && (
              <Chip 
                label="Error" 
                color="error" 
                size="small" 
                onClick={() => alert(status.lastError)} 
                sx={{ cursor: 'pointer' }}
              />
            )}
            <Chip 
              icon={<Refresh sx={{ animation: status.isCrawling ? 'spin 2s linear infinite' : 'none' }} />}
              label={status.isCrawling ? (status.currentTask || 'Crawling...') : 'Idle'} 
              color={status.isCrawling ? "primary" : "default"}
              variant="outlined"
              size="small"
              onClick={!status.isCrawling ? triggerCrawl : undefined}
              sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.5)', '& .MuiChip-icon': { color: 'inherit' }, cursor: !status.isCrawling ? 'pointer' : 'default' }}
            />
          </Box>
          <style>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
          <IconButton color="inherit" onClick={fetchData}><Refresh /></IconButton>
          <IconButton color="inherit" onClick={() => setSettingsOpen(true)}><Settings /></IconButton>
        </Toolbar>
      </AppBar>

      <Container sx={{ mt: 4 }}>
        <Grid container spacing={3}>
          {articles.map((article) => (
            <GridItem key={article.id} item xs={12} md={6} lg={4}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flexGrow: 1 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Typography variant="h6" gutterBottom>{article.translated_title}</Typography>
                    <Chip 
                      label={article.average_score.toFixed(1)} 
                      color={article.average_score >= 4 ? "primary" : "secondary"} 
                      size="small" 
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {article.short_summary}
                  </Typography>
                </CardContent>
                <CardActions>
                  <Button size="small" onClick={() => setSelectedArticle(article)}>Details</Button>
                  <IconButton size="small" href={article.url} target="_blank"><OpenInNew /></IconButton>
                </CardActions>
              </Card>
            </GridItem>
          ))}
        </Grid>
      </Container>

      {/* Details Dialog */}
      <Dialog open={!!selectedArticle} onClose={() => setSelectedArticle(null)} maxWidth="md" fullWidth>
        {selectedArticle && (
          <>
            <DialogTitle>{selectedArticle.translated_title}</DialogTitle>
            <DialogContent dividers>
              <Grid container spacing={2}>
                <GridItem item xs={12} md={6}>
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={getRadarData(selectedArticle)}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="subject" />
                        <Radar name="Score" dataKey="A" stroke="#1976d2" fill="#1976d2" fillOpacity={0.6} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </Box>
                </GridItem>
                <GridItem item xs={12} md={6}>
                  <Typography variant="subtitle1" fontWeight="bold">Summary</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{selectedArticle.summary}</Typography>
                </GridItem>
              </Grid>
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onClose={() => { setSettingsOpen(false); saveConfig(); }} maxWidth="sm" fullWidth>
        <DialogTitle>Settings</DialogTitle>
        <DialogContent dividers>
          {config && (
            <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 1 }}>
              <TextField 
                label="OpenRouter API Key" 
                type="password" 
                fullWidth 
                value={config.open_router_api_key || ''} 
                onChange={(e) => setConfig({...config, open_router_api_key: e.target.value})}
              />
              <TextField 
                label="Discord Webhook URL" 
                fullWidth 
                value={config.discord_webhook_url || ''} 
                onChange={(e) => setConfig({...config, discord_webhook_url: e.target.value})}
              />
              <TextField 
                label="Score Threshold" 
                type="number" 
                fullWidth 
                value={config.score_threshold} 
                onChange={(e) => setConfig({...config, score_threshold: parseFloat(e.target.value)})}
              />
              
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" fontWeight="bold">RSS Sources</Typography>
              <Box display="flex" gap={1}>
                <TextField label="Name" size="small" value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} />
                <TextField label="URL" size="small" sx={{ flexGrow: 1 }} value={newSourceUrl} onChange={(e) => setNewSourceUrl(e.target.value)} />
                <IconButton onClick={addSource} color="primary"><Add /></IconButton>
              </Box>
              <List dense>
                {sources.map(s => (
                  <ListItem key={s.id}>
                    <ListItemText primary={s.name} secondary={s.url} />
                    <ListItemSecondaryAction>
                      <IconButton edge="end" onClick={() => deleteSource(s.id)}><Delete /></IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
