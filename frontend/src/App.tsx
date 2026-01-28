import React, { useEffect, useState, useMemo } from 'react';
import { 
  AppBar, Toolbar, Typography, Container, Grid, Card, CardContent, 
  Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Box, Chip,
  TextField, List, ListItem, ListItemText, ListItemSecondaryAction, Avatar, CircularProgress,
  Paper, Tabs, Tab, MenuItem, Select, FormControl, InputLabel, Slider, CardMedia
} from '@mui/material';
import { Refresh, Settings, Delete, Add, ChatBubbleOutline, PersonAdd, Share as IosShare, FilterList, Newspaper as NewspaperIcon } from '@mui/icons-material';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import axios from 'axios';

interface Article {
  id: number;
  url: string;
  original_title: string;
  translated_title: string;
  summary: string;
  short_summary: string;
  image_url: string;
  average_score: number;
  score_novelty: number;
  score_importance: number;
  score_reliability: number;
  score_context_value: number;
  score_thought_provoking: number;
  created_at: string;
}

interface Character {
  id: number;
  name: string;
  persona: string;
  avatar: string | null;
  role: 'expert' | 'learner';
}

interface ScriptRecord {
    id: number;
    content: { speaker: 'A' | 'B', text: string }[];
    charA: { name: string, avatar: string | null };
    charB: { name: string, avatar: string | null };
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

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [status, setStatus] = useState<CrawlerStatus>({ isCrawling: false, lastRun: null, currentTask: null, articlesProcessed: 0, lastError: null });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterKeywords, setFilterKeywords] = useState('');
  const [filterThresholds, setFilterThresholds] = useState({ average: 0, novelty: 0, importance: 0, reliability: 0, context: 0, thinking: 0 });
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [sharing, setSharing] = useState(false);
  const [scripts, setScripts] = useState<ScriptRecord[]>([]);
  const [loadingScript, setLoadingScript] = useState(false);
  const [selectedScriptIndex, setSelectedScriptIndex] = useState(0);
  const [scriptLength, setScriptLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [genCharA, setGenCharA] = useState<number | ''>('');
  const [genCharB, setGenCharB] = useState<number | ''>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState(0);
  const [errorOpen, setErrorOpen] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [editCharId, setEditCharId] = useState<number | null>(null);
  const [charForm, setCharForm] = useState({ name: '', persona: '', avatar: '', role: 'expert' as 'expert' | 'learner' });

  const fetchData = async () => {
    try {
      const [artRes, confRes, sourRes, statRes, charRes] = await Promise.all([
        axios.get('/api/articles'), axios.get('/api/config'), axios.get('/api/sources'), axios.get('/api/status'), axios.get('/api/characters')
      ]);
      setArticles(artRes.data); setConfig(confRes.data); setSources(sourRes.data); setStatus(statRes.data); setCharacters(charRes.data);
      if (charRes.data.length >= 2) {
          const experts = charRes.data.filter((c: Character) => c.role === 'expert');
          const learners = charRes.data.filter((c: Character) => c.role === 'learner');
          if (!genCharA && experts.length > 0) setGenCharA(experts[0].id);
          if (!genCharB && learners.length > 0) setGenCharB(learners[0].id);
      }
    } catch (e) { console.error(e); }
  };

  const fetchScripts = async (articleId: number) => {
    try { const res = await axios.get(`/api/articles/${articleId}/scripts`); setScripts(res.data); setSelectedScriptIndex(0); } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchData(); const interval = setInterval(fetchData, 8000); return () => clearInterval(interval); }, []);
  useEffect(() => { if (selectedArticle) fetchScripts(selectedArticle.id); else setScripts([]); }, [selectedArticle]);

  const saveConfig = async () => { if (!config) return; await axios.post('/api/config', config); };
  const triggerCrawl = async () => { setStatus(prev => ({ ...prev, isCrawling: true, currentTask: 'Starting...' })); await axios.post('/api/crawl'); fetchData(); };
  const stopCrawl = async () => { await axios.delete('/api/crawl'); fetchData(); };
  const generateScript = async () => {
      if (!selectedArticle || !genCharA || !genCharB) return;
      setLoadingScript(true);
      try { await axios.post(`/api/articles/${selectedArticle.id}/scripts`, { charAId: genCharA, charBId: genCharB, length: scriptLength }); await fetchScripts(selectedArticle.id); } 
      catch (e) { alert('Failed to generate script'); } finally { setLoadingScript(false); }
  };

  const addOrUpdateCharacter = async () => { if (editCharId) await axios.put(`/api/characters/${editCharId}`, charForm); else await axios.post('/api/characters', charForm); setCharForm({ name: '', persona: '', avatar: '', role: 'expert' }); setEditCharId(null); fetchData(); };
  const deleteChar = async (id: number) => { await axios.delete(`/api/characters/${id}`); fetchData(); };
  const addSource = async () => { if (!newSourceUrl) return; await axios.post('/api/sources', { url: newSourceUrl, name: newSourceName }); setNewSourceUrl(''); setNewSourceName(''); fetchData(); };
  const deleteSource = async (id: number) => { await axios.delete(`/api/sources/${id}`); fetchData(); };
  const shareToDiscord = async (articleId: number) => { setSharing(true); try { await axios.post(`/api/articles/${articleId}/share`); alert('Shared!'); } catch (e) { alert('Failed'); } finally { setSharing(false); } };
  const clearFilters = () => { setFilterKeywords(''); setFilterThresholds({ average: 0, novelty: 0, importance: 0, reliability: 0, context: 0, thinking: 0 }); };

  const filteredArticles = useMemo(() => {
    return articles.filter(a => {
      if (filterKeywords) {
        const kw = filterKeywords.toLowerCase();
        if (!(a.translated_title || a.original_title || '').toLowerCase().includes(kw) && !(a.summary || '').toLowerCase().includes(kw)) return false;
      }
      if ((a.average_score || 0) < filterThresholds.average) return false;
      if ((a.score_novelty || 0) < filterThresholds.novelty) return false;
      if ((a.score_importance || 0) < filterThresholds.importance) return false;
      if ((a.score_reliability || 0) < filterThresholds.reliability) return false;
      if ((a.score_context_value || 0) < filterThresholds.context) return false;
      if ((a.score_thought_provoking || 0) < filterThresholds.thinking) return false;
      return true;
    });
  }, [articles, filterKeywords, filterThresholds]);

  const ImageWithFallback = ({ src, alt, height = 180 }: { src: string | null, alt: string, height?: number }) => {
    const [error, setError] = useState(false);
    if (!src || error) {
      return (
        <Box sx={{ height, width: '100%', bgcolor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9e9e9e' }}>
          <NewspaperIcon sx={{ fontSize: height > 100 ? 48 : 24 }} />
        </Box>
      );
    }
    return (
      <CardMedia
        component="img"
        height={height}
        image={src}
        alt={alt}
        sx={{ objectFit: 'cover' }}
        onError={() => setError(true)}
      />
    );
  };

  return (
    <Box sx={{ flexGrow: 1, bgcolor: '#f0f2f5', minHeight: '100vh' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: '#fff', color: '#1a1a1a', borderBottom: '1px solid #ddd' }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 'bold' }}>🦤 AI News Insider</Typography>
          <Box sx={{ mr: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button size="small" variant="outlined" startIcon={<FilterList />} onClick={() => setFilterOpen(true)} color={Object.values(filterThresholds).some(v => v > 0) || filterKeywords ? "primary" : "inherit"}>Filter</Button>
            {status.lastError && <Chip label="Error" color="error" size="small" onClick={() => setErrorOpen(true)} sx={{ cursor: 'pointer' }} />}
            <Chip icon={<Refresh sx={{ animation: status.isCrawling ? 'spin 2s linear infinite' : 'none' }} />} label={status.isCrawling ? (status.currentTask || 'Working...') : 'Idle'} color={status.isCrawling ? "primary" : "default"} variant="outlined" size="small" />
            <Button size="small" color={status.isCrawling ? "error" : "primary"} variant="contained" onClick={status.isCrawling ? stopCrawl : triggerCrawl}>{status.isCrawling ? 'Stop' : 'Start Scan'}</Button>
          </Box>
          <IconButton onClick={() => setSettingsOpen(true)}><Settings /></IconButton>
        </Toolbar>
      </AppBar>

      <Container sx={{ mt: 4, pb: 4 }}>
        <Grid container spacing={3}>
          {filteredArticles.map((article) => (
            <Grid item key={article.id} xs={12} md={6} lg={4}>
              <Card sx={{ height: '100%', cursor: 'pointer', display: 'flex', flexDirection: 'column', '&:hover': { transform: 'translateY(-4px)', boxShadow: 4 } }} onClick={() => setSelectedArticle(article)}>
                <ImageWithFallback src={article.image_url} alt={article.original_title} />
                <CardContent sx={{ flexGrow: 1 }}>
                  <Box display="flex" justifyContent="space-between" mb={1}><Typography variant="caption" color="text.secondary">{new Date(article.created_at).toLocaleDateString()}</Typography><Chip label={article.average_score?.toFixed(1) || 'N/A'} color="primary" size="small" /></Box>
                  <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 'bold', mb: 1 }}>{article.translated_title || article.original_title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{article.short_summary}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      <Dialog open={!!selectedArticle} onClose={() => setSelectedArticle(null)} maxWidth="lg" fullWidth>
        {selectedArticle && (
          <DialogContent sx={{ p: 0 }}>
            <Grid container sx={{ minHeight: '80vh' }}>
              <Grid item xs={12} md={4} sx={{ borderRight: '1px solid #ddd', p: 3, bgcolor: '#fafafa' }}>
                <ImageWithFallback src={selectedArticle.image_url} alt={selectedArticle.original_title} height={200} />
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" sx={{ mt: 2 }}>
                  <Typography 
                    variant="h6" 
                    component="a" 
                    href={selectedArticle.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    sx={{ textDecoration: 'none', color: 'primary.main', '&:hover': { textDecoration: 'underline' }, fontWeight: 'bold' , flexGrow: 1}}
                  >
                    {selectedArticle.translated_title || selectedArticle.original_title}
                  </Typography>
                  <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); shareToDiscord(selectedArticle.id); }} disabled={sharing}>
                    {sharing ? <CircularProgress size={20} /> : <IosShare />}
                  </IconButton>
                </Box>
                <Box sx={{ height: 200, my: 2 }}>
                  {/* @ts-ignore */}
                  <ResponsiveContainer>
                    {/* @ts-ignore */}
                    <RadarChart data={[{ subject: 'Novelty', A: selectedArticle.score_novelty }, { subject: 'Importance', A: selectedArticle.score_importance }, { subject: 'Reliability', A: selectedArticle.score_reliability }, { subject: 'Context', A: selectedArticle.score_context_value }, { subject: 'Thinking', A: selectedArticle.score_thought_provoking }]}>
                      <PolarGrid />
                      {/* @ts-ignore */}
                      <PolarAngleAxis dataKey="subject" />
                      {/* @ts-ignore */}
                      <Radar dataKey="A" stroke="#1976d2" fill="#1976d2" fillOpacity={0.5} />
                    </RadarChart>
                  </ResponsiveContainer>
                </Box>
                <Typography variant="body2" color="text.secondary">{selectedArticle.summary}</Typography>
              </Grid>
              <Grid item xs={12} md={8} sx={{ display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ p: 2, borderBottom: '1px solid #ddd', display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <FormControl size="small" sx={{ minWidth: 120 }}><InputLabel>Expert (A)</InputLabel><Select value={genCharA} label="Expert (A)" onChange={e => setGenCharA(e.target.value as number)}>{characters.filter(c => c.role === 'expert').map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
                  <FormControl size="small" sx={{ minWidth: 120 }}><InputLabel>Learner (B)</InputLabel><Select value={genCharB} label="Learner (B)" onChange={e => setGenCharB(e.target.value as number)}>{characters.filter(c => c.role === 'learner').map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
                  <FormControl size="small" sx={{ minWidth: 100 }}><InputLabel>Length</InputLabel><Select value={scriptLength} label="Length" onChange={e => setScriptLength(e.target.value as any)}><MenuItem value="short">Short</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="long">Long</MenuItem></Select></FormControl>
                  <Button variant="contained" size="small" onClick={generateScript} disabled={loadingScript || !genCharA || !genCharB}>{loadingScript ? <CircularProgress size={20} /> : 'Generate'}</Button>
                </Box>
                <Box sx={{ flexGrow: 1, p: 3, overflowY: 'auto' }}>
                  {scripts.length > 0 ? (<>{scripts[selectedScriptIndex].content.map((msg, i) => (<Box key={i} sx={{ display: 'flex', gap: 2, mb: 3, flexDirection: msg.speaker === 'B' ? 'row' : 'row-reverse' }}><Avatar src={(msg.speaker === 'A' ? scripts[selectedScriptIndex].charA.avatar : scripts[selectedScriptIndex].charB.avatar) || undefined} /><Paper sx={{ p: 2, maxWidth: '80%', bgcolor: msg.speaker === 'B' ? '#e3f2fd' : '#f5f5f5' }}><Typography variant="caption" fontWeight="bold" display="block">{msg.speaker === 'A' ? scripts[selectedScriptIndex].charA.name : scripts[selectedScriptIndex].charB.name}</Typography><Typography variant="body2">{msg.text}</Typography></Paper></Box>))}</>) : <Typography color="text.secondary" textAlign="center" mt={4}>Choose characters and click Generate!</Typography>}
                </Box>
              </Grid>
            </Grid>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={settingsOpen} onClose={() => { setSettingsOpen(false); saveConfig(); fetchData(); }} maxWidth="md" fullWidth>
        <DialogTitle>Settings & Database</DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}><Tabs value={settingsTab} onChange={(_, v) => setSettingsTab(v)}><Tab label="General" /><Tab label="Characters" /><Tab label="RSS Sources" /></Tabs></Box>
        <DialogContent sx={{ minHeight: '400px' }}>
          {settingsTab === 0 && <Box sx={{ py: 2 }}>{config && (<><TextField label="OpenRouter API Key" type="password" fullWidth sx={{ mb: 3 }} value={config.open_router_api_key || ''} onChange={e => setConfig({...config, open_router_api_key: e.target.value})} /><TextField label="Discord Webhook URL" fullWidth sx={{ mb: 3 }} value={config.discord_webhook_url || ''} onChange={e => setConfig({...config, discord_webhook_url: e.target.value})} /><TextField label="Threshold" type="number" fullWidth sx={{ mb: 2 }} inputProps={{ min: 0, max: 10, step: 0.1 }} value={config.score_threshold || 0} onChange={e => setConfig({...config, score_threshold: parseFloat(e.target.value)})} /></>)}</Box>}
          {settingsTab === 1 && <Box sx={{ py: 2 }}><Grid container spacing={2} sx={{ mb: 3 }}><Grid item xs={12} md={3}><TextField label="Name" fullWidth size="small" value={charForm.name} onChange={e => setCharForm({...charForm, name: e.target.value})} /></Grid><Grid item xs={12} md={4}><TextField label="Persona" fullWidth size="small" value={charForm.persona} onChange={e => setCharForm({...charForm, persona: e.target.value})} /></Grid><Grid item xs={12} md={3}><TextField label="Avatar URL" fullWidth size="small" value={charForm.avatar} onChange={e => setCharForm({...charForm, avatar: e.target.value})} /></Grid><Grid item xs={12} md={2}><Select fullWidth size="small" value={charForm.role} onChange={e => setCharForm({...charForm, role: e.target.value as any})}><MenuItem value="expert">Expert</MenuItem><MenuItem value="learner">Learner</MenuItem></Select></Grid><Grid item xs={12}><Button variant="contained" fullWidth startIcon={<PersonAdd />} onClick={addOrUpdateCharacter}>{editCharId ? 'Update' : 'Add'} Character</Button></Grid></Grid><List dense sx={{ bgcolor: '#f8f8f8', borderRadius: 1 }}>{characters.map(c => (<ListItem key={c.id} divider><Avatar src={c.avatar || undefined} sx={{ mr: 2 }} /><ListItemText primary={`${c.name} (${c.role})`} secondary={c.persona} /><ListItemSecondaryAction><IconButton size="small" onClick={() => { setEditCharId(c.id); setCharForm({ name: c.name, persona: c.persona, avatar: c.avatar || '', role: c.role }); }}><ChatBubbleOutline fontSize="small" /></IconButton><IconButton size="small" color="error" onClick={() => deleteChar(c.id)}><Delete fontSize="small" /></IconButton></ListItemSecondaryAction></ListItem>))}</List></Box>}
          {settingsTab === 2 && <Box sx={{ py: 2 }}><Grid container spacing={2} sx={{ mb: 3 }}><Grid item xs={12} md={5}><TextField label="Name" fullWidth size="small" value={newSourceName} onChange={e => setNewSourceName(e.target.value)} /></Grid><Grid item xs={12} md={5}><TextField label="URL" fullWidth size="small" value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)} /></Grid><Grid item xs={12} md={2}><Button variant="contained" fullWidth startIcon={<Add />} onClick={addSource}>Add</Button></Grid></Grid><List dense sx={{ bgcolor: '#f8f8f8', borderRadius: 1 }}>{sources.map(s => (<ListItem key={s.id} divider><ListItemText primary={s.name} secondary={s.url} /><ListItemSecondaryAction><IconButton size="small" color="error" onClick={() => deleteSource(s.id)}><Delete fontSize="small" /></IconButton></ListItemSecondaryAction></ListItem>))}</List></Box>}
        </DialogContent>
        <Box sx={{ p: 2, textAlign: 'right' }}><Button onClick={() => { setSettingsOpen(false); saveConfig(); fetchData(); }} color="primary" variant="contained">Close & Save</Button></Box>
      </Dialog>
      <Dialog open={errorOpen} onClose={() => setErrorOpen(false)} maxWidth="md" fullWidth><DialogTitle>Error</DialogTitle><DialogContent sx={{ bgcolor: '#fff0f0' }}><Typography variant="body2">{status.lastError}</Typography></DialogContent></Dialog>
      <Dialog open={filterOpen} onClose={() => setFilterOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Advanced Filter</DialogTitle>
        <DialogContent>
          <TextField label="Keywords" fullWidth size="small" sx={{ my: 2 }} value={filterKeywords} onChange={e => setFilterKeywords(e.target.value)} />
          
          <Typography variant="caption" display="block">Minimum Average Score (0-5)</Typography>
          <Slider value={filterThresholds.average} onChange={(_, v) => setFilterThresholds({ ...filterThresholds, average: v as number })} min={0} max={5} step={0.1} valueLabelDisplay="auto" sx={{ mb: 2 }} />

          <Typography variant="caption" display="block">Novelty</Typography>
          <Slider value={filterThresholds.novelty} onChange={(_, v) => setFilterThresholds({ ...filterThresholds, novelty: v as number })} min={0} max={5} step={0.5} valueLabelDisplay="auto" />

          <Typography variant="caption" display="block">Importance</Typography>
          <Slider value={filterThresholds.importance} onChange={(_, v) => setFilterThresholds({ ...filterThresholds, importance: v as number })} min={0} max={5} step={0.5} valueLabelDisplay="auto" />

          <Typography variant="caption" display="block">Reliability</Typography>
          <Slider value={filterThresholds.reliability} onChange={(_, v) => setFilterThresholds({ ...filterThresholds, reliability: v as number })} min={0} max={5} step={0.5} valueLabelDisplay="auto" />

          <Typography variant="caption" display="block">Context Value</Typography>
          <Slider value={filterThresholds.context} onChange={(_, v) => setFilterThresholds({ ...filterThresholds, context: v as number })} min={0} max={5} step={0.5} valueLabelDisplay="auto" />

          <Typography variant="caption" display="block">Thought Provoking</Typography>
          <Slider value={filterThresholds.thinking} onChange={(_, v) => setFilterThresholds({ ...filterThresholds, thinking: v as number })} min={0} max={5} step={0.5} valueLabelDisplay="auto" />
        </DialogContent>
        <DialogActions>
          <Button onClick={clearFilters}>Clear All</Button>
          <Button onClick={() => setFilterOpen(false)} variant="contained">Apply</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
