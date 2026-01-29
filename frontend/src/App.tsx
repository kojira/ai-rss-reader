import React, { useEffect, useState, useMemo } from 'react';
import { 
  AppBar, Toolbar, Typography, Container, Grid, Card, CardContent, 
  Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Box, Chip,
  TextField, List, ListItem, ListItemText, ListItemSecondaryAction, Avatar, CircularProgress,
  Paper, Tabs, Tab, MenuItem, Select, FormControl, InputLabel, Slider, CardMedia
} from '@mui/material';
import { Refresh, Settings, Delete, Add, ChatBubbleOutline, PersonAdd, Share as IosShare, FilterList, Newspaper as NewspaperIcon, ViewModule, ViewStream, KeyboardArrowUp } from '@mui/icons-material';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import axios from 'axios';
import { Fab, Zoom, useScrollTrigger } from '@mui/material';

interface Article {
  id: number;
  url: string;
  resolved_url: string | null;
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
  published_at: string | null;
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

interface ArticleError {
  id: number;
  url: string;
  title_hint: string | null;
  error_message: string;
  stack_trace: string | null;
  phase: string | null;
  context: string | null;
  created_at: string;
}

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [failedProcesses, setFailedProcesses] = useState<ArticleError[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [expandedError, setExpandedError] = useState<number | null>(null);
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
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [retryingArticle, setRetryingArticle] = useState(false);
  const [retryErrorDetail, setRetryErrorDetail] = useState<string | null>(null);

  const [gridLayout, setGridLayout] = useState<number>(() => {
    const saved = localStorage.getItem('gridLayout');
    return saved ? parseInt(saved, 10) : 1;
  });

  const [hasMore, setHasMore] = useState(true);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const ARTICLES_PER_PAGE = 12;

  const fetchInitialData = async () => {
    try {
      setLoadingArticles(true);
      const [artRes, confRes, sourRes, statRes, charRes, errRes] = await Promise.all([
        axios.get(`/api/articles?limit=${ARTICLES_PER_PAGE}&offset=0&keyword=${filterKeywords}&minScore=${filterThresholds.average}`), 
        axios.get('/api/config'), 
        axios.get('/api/sources'), 
        axios.get('/api/status'), 
        axios.get('/api/characters'),
        axios.get('/api/articles/errors')
      ]);
      setArticles(artRes.data);
      setHasMore(artRes.data.length === ARTICLES_PER_PAGE);
      setConfig(confRes.data); 
      setSources(sourRes.data); 
      setStatus({
        ...statRes.data,
        isCrawling: statRes.data.is_crawling === 1,
        currentTask: statRes.data.current_task,
        articlesProcessed: statRes.data.articles_processed,
        lastError: statRes.data.last_error
      }); 
      setCharacters(charRes.data);
      setFailedProcesses(errRes.data);
      
      if (charRes.data.length >= 2) {
          const experts = charRes.data.filter((c: Character) => c.role === 'expert');
          const learners = charRes.data.filter((c: Character) => c.role === 'learner');
          if (!genCharA && experts.length > 0) setGenCharA(experts[0].id);
          if (!genCharB && learners.length > 0) setGenCharB(learners[0].id);
      }
    } catch (e) { console.error(e); } finally { setLoadingArticles(false); }
  };

  const loadMoreArticles = async () => {
    if (loadingArticles || !hasMore) return;
    setLoadingArticles(true);
    try {
      const res = await axios.get(`/api/articles?limit=${ARTICLES_PER_PAGE}&offset=${articles.length}&keyword=${filterKeywords}&minScore=${filterThresholds.average}`);
      setArticles(prev => [...prev, ...res.data]);
      setHasMore(res.data.length === ARTICLES_PER_PAGE);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingArticles(false);
    }
  };

  const fetchScripts = async (articleId: number) => {
    try { 
      const res = await axios.get(`/api/articles/${articleId}/scripts`); 
      setScripts(res.data); 
      // Ensure we don't try to access index out of bounds if new scripts are fewer
      setSelectedScriptIndex(0); 
    } catch (e) { console.error(e); }
  };

  useEffect(() => { 
    fetchInitialData(); 
    const statusInterval = setInterval(async () => {
      try {
        const statRes = await axios.get('/api/status');
        setStatus({
          ...statRes.data,
          isCrawling: statRes.data.is_crawling === 1,
          currentTask: statRes.data.current_task,
          articlesProcessed: statRes.data.articles_processed,
          lastError: statRes.data.last_error
        });
        if (statRes.data.errors) {
          setFailedProcesses(statRes.data.errors);
        }
      } catch (e) { console.error(e); }
    }, 8000); 
    return () => clearInterval(statusInterval); 
  }, [filterKeywords, filterThresholds.average]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loadingArticles) {
          loadMoreArticles();
        }
      },
      { threshold: 1.0 }
    );

    const target = document.querySelector('#bottom-observer');
    if (target) observer.observe(target);

    return () => {
      if (target) observer.unobserve(target);
    };
  }, [hasMore, loadingArticles, articles.length]);

  useEffect(() => { 
    if (selectedArticle) {
      setSelectedScriptIndex(0);
      fetchScripts(selectedArticle.id); 
    } else {
      setScripts([]); 
      setSelectedScriptIndex(0); 
    }
  }, [selectedArticle]);

  const saveConfig = async () => { if (!config) return; await axios.post('/api/config', config); };
  const triggerCrawl = async () => { setStatus(prev => ({ ...prev, isCrawling: true, currentTask: 'Starting...' })); await axios.post('/api/crawl'); };
  const stopCrawl = async () => { await axios.delete('/api/crawl'); };
  const generateScript = async () => {
      if (!selectedArticle || !genCharA || !genCharB) return;
      setLoadingScript(true);
      try { await axios.post(`/api/articles/${selectedArticle.id}/scripts`, { charAId: genCharA, charBId: genCharB, length: scriptLength }); await fetchScripts(selectedArticle.id); } 
      catch (e) { alert('Failed to generate script'); } finally { setLoadingScript(false); }
  };

  const addOrUpdateCharacter = async () => { if (editCharId) await axios.put(`/api/characters/${editCharId}`, charForm); else await axios.post('/api/characters', charForm); setCharForm({ name: '', persona: '', avatar: '', role: 'expert' }); setEditCharId(null); fetchInitialData(); };
  const deleteChar = async (id: number) => { await axios.delete(`/api/characters/${id}`); fetchInitialData(); };
  const addSource = async () => { if (!newSourceUrl) return; await axios.post('/api/sources', { url: newSourceUrl, name: newSourceName }); setNewSourceUrl(''); setNewSourceName(''); fetchInitialData(); };
  const deleteSource = async (id: number) => { await axios.delete(`/api/sources/${id}`); fetchInitialData(); };

  const trigger = useScrollTrigger({
    disableHysteresis: true,
    threshold: 300,
  });

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  const ingestUrlAction = async () => {
    if (!ingestUrl) return;
    setIngesting(true);
    setRetryErrorDetail(null);
    try {
      const res = await axios.post('/api/articles/ingest', { url: ingestUrl });
      setIngestOpen(false);
      setIngestUrl('');
      await fetchInitialData();
      if (res.data.article) {
        setSelectedArticle(res.data.article);
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage = e.response?.data?.error || e.response?.data?.message || e.message || 'Failed to ingest URL';
      setRetryErrorDetail(errorMessage);
    } finally {
      setIngesting(false);
    }
  };
  const retryError = async (id: number) => { 
    try { 
      await axios.post(`/api/errors/${id}/retry`); 
      fetchInitialData(); 
    } catch (e: any) { 
      console.error(e);
      const errorMessage = e.response?.data?.error || e.response?.data?.message || e.message || 'Failed to retry';
      setRetryErrorDetail(errorMessage);
    } 
  };
  const retryArticle = async (id: number) => {
    setRetryingArticle(true);
    setRetryErrorDetail(null);
    try {
      const res = await axios.post(`/api/articles/${id}/retry`);
      if (res.data.article) {
        setSelectedArticle(res.data.article);
        // Refresh the list to show updated content
        const [artRes, errRes] = await Promise.all([
          axios.get(`/api/articles?limit=${articles.length}&offset=0&keyword=${filterKeywords}&minScore=${filterThresholds.average}`),
          axios.get('/api/articles/errors')
        ]);
        setArticles(artRes.data);
        setFailedProcesses(errRes.data);
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage = e.response?.data?.error || e.response?.data?.message || e.message || 'Failed to retry article';
      setRetryErrorDetail(errorMessage);
    } finally {
      setRetryingArticle(false);
    }
  };
  const deleteError = async (id: number) => { try { await axios.delete(`/api/errors/${id}`); fetchInitialData(); } catch (e) { alert('Failed to delete error'); } };
  const shareToDiscord = async (articleId: number) => { setSharing(true); try { await axios.post(`/api/articles/${articleId}/share`); alert('Shared!'); } catch (e) { alert('Failed'); } finally { setSharing(false); } };
  const clearFilters = () => { setFilterKeywords(''); setFilterThresholds({ average: 0, novelty: 0, importance: 0, reliability: 0, context: 0, thinking: 0 }); };

  const toggleGridLayout = () => {
    const newVal = gridLayout === 1 ? 2 : 1;
    setGridLayout(newVal);
    localStorage.setItem('gridLayout', newVal.toString());
  };

  const filteredArticles = useMemo(() => {
    return articles.filter(a => {
      // average_score and keyword are already filtered on backend in fetchInitialData
      // but we still apply them here for safety or if the state is out of sync
      if (filterKeywords) {
        const kw = filterKeywords.toLowerCase();
        if (!(a.translated_title || a.original_title || '').toLowerCase().includes(kw) && !(a.summary || '').toLowerCase().includes(kw)) return false;
      }
      if ((a.average_score || 0) < filterThresholds.average) return false;
      
      // These are still local-only filtering (optional optimization)
      if ((a.score_novelty || 0) < filterThresholds.novelty) return false;
      if ((a.score_importance || 0) < filterThresholds.importance) return false;
      if ((a.score_reliability || 0) < filterThresholds.reliability) return false;
      if ((a.score_context_value || 0) < filterThresholds.context) return false;
      if ((a.score_thought_provoking || 0) < filterThresholds.thinking) return false;
      return true;
    });
  }, [articles, filterKeywords, filterThresholds]);

  const ImageWithFallback = ({ src, alt, height = '100%' }: { src: string | null, alt: string, height?: number | string }) => {
    const [error, setError] = useState(false);
    if (!src || error) {
      return (
        <Box sx={{ height, width: '100%', bgcolor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9e9e9e' }}>
          <NewspaperIcon sx={{ fontSize: '2rem' }} />
        </Box>
      );
    }
    return (
      <CardMedia
        component="img"
        image={src}
        alt={alt}
        sx={{ objectFit: 'cover', height: '100%', width: '100%' }}
        onError={() => setError(true)}
      />
    );
  };

  return (
    <Box sx={{ flexGrow: 1, bgcolor: '#f0f2f5', minHeight: '100vh', overflowX: 'hidden' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: '#fff', color: '#1a1a1a', borderBottom: '1px solid #ddd' }}>
        <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
          <Typography 
            variant="h6" 
            sx={{ 
              flexGrow: 1, 
              fontWeight: 'bold',
              fontSize: { xs: '1rem', sm: '1.25rem' },
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            🦤 AI News Insider
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1, md: 2 } }}>
            <IconButton 
              size="small" 
              onClick={() => setIngestOpen(true)} 
              color="primary"
              title="Manual Add"
              sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
            >
              <Add />
            </IconButton>
            <Button 
              size="small" 
              variant="outlined" 
              startIcon={<Add />} 
              onClick={() => setIngestOpen(true)} 
              color="primary"
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            >
              Manual Add
            </Button>

            <IconButton 
              size="small" 
              onClick={() => setFilterOpen(true)} 
              color={Object.values(filterThresholds).some(v => v > 0) || filterKeywords ? "primary" : "default"}
              title="Filter"
              sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
            >
              <FilterList />
            </IconButton>
            <Button 
              size="small" 
              variant="outlined" 
              startIcon={<FilterList />} 
              onClick={() => setFilterOpen(true)} 
              color={Object.values(filterThresholds).some(v => v > 0) || filterKeywords ? "primary" : "inherit"}
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            >
              Filter
            </Button>

            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Chip 
                icon={<Refresh sx={{ animation: status.isCrawling ? 'spin 2s linear infinite' : 'none', fontSize: '1rem !important' }} />} 
                label={status.isCrawling ? (status.currentTask || 'Working...') : 'Idle'} 
                color={status.isCrawling ? "primary" : "default"} 
                variant="outlined" 
                size="small" 
                sx={{ 
                  display: { xs: status.isCrawling ? 'flex' : 'none', md: 'flex' },
                  maxWidth: { xs: 80, sm: 'none' },
                  '& .MuiChip-label': {
                    display: { xs: status.isCrawling ? 'block' : 'none', md: 'block' }
                  }
                }}
              />
            </Box>

            <Button 
              size="small" 
              color={status.isCrawling ? "error" : "primary"} 
              variant="contained" 
              onClick={status.isCrawling ? stopCrawl : triggerCrawl}
              sx={{ 
                minWidth: { xs: 'auto', sm: 80 },
                px: { xs: 1, sm: 2 }
              }}
            >
              {status.isCrawling ? 'Stop' : (
                <>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Start Scan</Box>
                  <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Start</Box>
                </>
              )}
            </Button>

            {status.lastError && (
              <IconButton size="small" color="error" onClick={() => setErrorOpen(true)} title="Error detail">
                <Chip label="!" color="error" size="small" sx={{ height: 20, width: 20, '& .MuiChip-label': { px: 0 }, cursor: 'pointer' }} />
              </IconButton>
            )}

            <IconButton 
              onClick={toggleGridLayout} 
              size="small" 
              title={gridLayout === 1 ? "Switch to 2 columns" : "Switch to 1 column"}
              sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
            >
              {gridLayout === 1 ? <ViewModule /> : <ViewStream />}
            </IconButton>

            <IconButton onClick={() => setSettingsOpen(true)} size="small" title="Settings">
              <Settings />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth={false} sx={{ mt: 4, pb: 4, px: { xs: 2, sm: 3, md: 4, lg: 6 } }}>
        <Grid container spacing={gridLayout === 2 ? 1 : 3} justifyContent="center" sx={{
          display: 'grid',
          gridTemplateColumns: gridLayout === 2 
            ? 'repeat(auto-fill, minmax(160px, 1fr))' 
            : 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: gridLayout === 2 ? '8px' : '24px',
          maxWidth: '2400px',
          margin: '0 auto'
        }}>
          {filteredArticles.map((article) => (
            <Box 
              key={article.id} 
              sx={{ width: '100%', maxWidth: 360, justifySelf: 'center' }}
            >
              <Card sx={{ 
                height: '100%', 
                cursor: 'pointer', 
                display: 'flex', 
                flexDirection: 'column', 
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 4 },
                bgcolor: '#fff',
                borderRadius: 2,
                overflow: 'hidden'
              }} onClick={() => setSelectedArticle(article)}>
                <Box sx={{ width: '100%', pt: '56.25%', position: 'relative' }}>
                  <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                    <ImageWithFallback src={article.image_url} alt={article.original_title} height="100%" />
                  </Box>
                </Box>
                <CardContent sx={{ 
                  flexGrow: 1, 
                  p: gridLayout === 2 ? 1 : 1.5, 
                  '&:last-child': { pb: gridLayout === 2 ? 1 : 1.5 } 
                }}>
                  <Box display="flex" justifyContent="space-between" mb={gridLayout === 2 ? 0.5 : 1}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: gridLayout === 2 ? '0.65rem' : '0.7rem' }}>
                      {new Date(article.published_at && article.published_at.trim() !== "" ? article.published_at : article.created_at).toLocaleDateString()}
                    </Typography>
                    <Chip label={article.average_score?.toFixed(1) || 'N/A'} color="primary" size="small" sx={{ height: gridLayout === 2 ? 18 : 20, '& .MuiChip-label': { px: gridLayout === 2 ? 0.5 : 1, fontSize: gridLayout === 2 ? '0.65rem' : '0.7rem' } }} />
                  </Box>
                  <Typography variant="h6" sx={{ 
                    fontSize: gridLayout === 2 ? '0.85rem' : { xs: '0.9rem', sm: '0.95rem', md: '1rem' }, 
                    fontWeight: 'bold', 
                    mb: gridLayout === 2 ? 0.5 : 1, 
                    display: '-webkit-box', 
                    WebkitLineClamp: 2, 
                    WebkitBoxOrient: 'vertical', 
                    overflow: 'hidden', 
                    lineHeight: 1.2 
                  }}>{article.translated_title || article.original_title}</Typography>
                  {(gridLayout === 1) && (
                    <Typography variant="body2" color="text.secondary" sx={{ 
                      display: { xs: '-webkit-box', lg: 'none', xl: '-webkit-box' }, 
                      WebkitLineClamp: 2, 
                      WebkitBoxOrient: 'vertical', 
                      overflow: 'hidden',
                      fontSize: '0.8rem',
                      lineHeight: 1.3
                    }}>{article.short_summary}</Typography>
                  )}
                </CardContent>
              </Card>
            </Box>
          ))}
        </Grid>
        
        <Box id="bottom-observer" sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
          {loadingArticles && (
            <Box sx={{ textAlign: 'center' }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Loading more news...</Typography>
            </Box>
          )}
          {!hasMore && articles.length > 0 && (
            <Typography variant="body2" color="text.secondary">No more articles to load.</Typography>
          )}
        </Box>
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
                    href={selectedArticle.resolved_url || selectedArticle.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    sx={{ textDecoration: 'none', color: 'primary.main', '&:hover': { textDecoration: 'underline' }, fontWeight: 'bold' , flexGrow: 1}}
                  >
                    {selectedArticle.translated_title || selectedArticle.original_title}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); retryArticle(selectedArticle.id); }} disabled={retryingArticle}>
                      {retryingArticle ? <CircularProgress size={20} /> : <Refresh />}
                    </IconButton>
                    <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); shareToDiscord(selectedArticle.id); }} disabled={sharing}>
                      {sharing ? <CircularProgress size={20} /> : <IosShare />}
                    </IconButton>
                  </Box>
                </Box>
                <Box sx={{ height: 200, my: 2 }}>
                  {/* @ts-ignore */}
                  <ResponsiveContainer>
                    {/* @ts-ignore */}
                    <RadarChart data={[{ subject: 'Novelty', A: selectedArticle.score_novelty }, { subject: 'Importance', A: selectedArticle.score_importance }, { subject: 'Reliability', A: selectedArticle.score_reliability }, { subject: 'Context', A: selectedArticle.score_context_value }, { subject: 'Thinking', A: selectedArticle.score_thought_provoking }]}>
                      <PolarGrid />
                      {/* @ts-ignore */}
                      <PolarAngleAxis dataKey="subject" />
                      <PolarRadiusAxis angle={30} domain={[0, 5]} />
                      {/* @ts-ignore */}
                      <Radar dataKey="A" stroke="#1976d2" fill="#1976d2" fillOpacity={0.5} />
                    </RadarChart>
                  </ResponsiveContainer>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {new Date(selectedArticle.published_at && selectedArticle.published_at.trim() !== "" ? selectedArticle.published_at : selectedArticle.created_at).toLocaleString()}
                </Typography>
                <Typography variant="body2" color="text.secondary">{selectedArticle.summary}</Typography>
              </Grid>
              <Grid item xs={12} md={8} sx={{ display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ p: 2, borderBottom: '1px solid #ddd', display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <FormControl size="small" sx={{ minWidth: 120 }}><InputLabel>Expert (A)</InputLabel><Select value={genCharA} label="Expert (A)" onChange={e => setGenCharA(e.target.value as number)}>{characters.filter(c => c.role === 'expert').map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
                  <FormControl size="small" sx={{ minWidth: 120 }}><InputLabel>Learner (B)</InputLabel><Select value={genCharB} label="Learner (B)" onChange={e => setGenCharB(e.target.value as number)}>{characters.filter(c => c.role === 'learner').map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
                  <FormControl size="small" sx={{ minWidth: 100 }}><InputLabel>Length</InputLabel><Select value={scriptLength} label="Length" onChange={e => setScriptLength(e.target.value as any)}><MenuItem value="short">Short</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="long">Long</MenuItem></Select></FormControl>
                  <Button variant="contained" size="small" onClick={generateScript} disabled={loadingScript || !genCharA || !genCharB}>{loadingScript ? <CircularProgress size={20} /> : 'Generate'}</Button>
                </Box>
                
                {scripts.length > 0 && (
                  <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={selectedScriptIndex} onChange={(_, v) => setSelectedScriptIndex(v)} variant="scrollable" scrollButtons="auto">
                      {scripts.map((_, i) => (
                        <Tab key={i} label={`Version ${i + 1}`} />
                      ))}
                    </Tabs>
                  </Box>
                )}

                <Box sx={{ flexGrow: 1, p: 3, overflowY: 'auto' }}>
                  {scripts.length > 0 ? (<>{scripts[selectedScriptIndex]?.content.map((msg, i) => (<Box key={i} sx={{ display: 'flex', gap: 2, mb: 3, flexDirection: msg.speaker === 'B' ? 'row' : 'row-reverse' }}><Avatar src={(msg.speaker === 'A' ? scripts[selectedScriptIndex].charA.avatar : scripts[selectedScriptIndex].charB.avatar) || undefined} /><Paper sx={{ p: 2, maxWidth: '80%', bgcolor: msg.speaker === 'B' ? '#e3f2fd' : '#f5f5f5' }}><Typography variant="caption" fontWeight="bold" display="block">{msg.speaker === 'A' ? scripts[selectedScriptIndex].charA.name : scripts[selectedScriptIndex].charB.name}</Typography><Typography variant="body2">{msg.text}</Typography></Paper></Box>))}</>) : <Typography color="text.secondary" textAlign="center" mt={4}>Choose characters and click Generate!</Typography>}
                </Box>
              </Grid>
            </Grid>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={settingsOpen} onClose={() => { setSettingsOpen(false); saveConfig(); fetchInitialData(); }} maxWidth="md" fullWidth>
        <DialogTitle>Settings & Database</DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}><Tabs value={settingsTab} onChange={(_, v) => setSettingsTab(v)}><Tab label="General" /><Tab label="Characters" /><Tab label="RSS Sources" /><Tab label="Failed Processes" /></Tabs></Box>
        <DialogContent sx={{ minHeight: '400px' }}>
          {settingsTab === 0 && <Box sx={{ py: 2 }}>{config && (<><TextField label="OpenRouter API Key" type="password" fullWidth sx={{ mb: 3 }} value={config.open_router_api_key || ''} onChange={e => setConfig({...config, open_router_api_key: e.target.value})} /><TextField label="Discord Webhook URL" fullWidth sx={{ mb: 3 }} value={config.discord_webhook_url || ''} onChange={e => setConfig({...config, discord_webhook_url: e.target.value})} /><TextField label="Threshold" type="number" fullWidth sx={{ mb: 2 }} inputProps={{ min: 0, max: 10, step: 0.1 }} value={config.score_threshold || 0} onChange={e => setConfig({...config, score_threshold: parseFloat(e.target.value)})} /></>)}</Box>}
          {settingsTab === 1 && <Box sx={{ py: 2 }}><Grid container spacing={2} sx={{ mb: 3 }}><Grid item xs={12} md={3}><TextField label="Name" fullWidth size="small" value={charForm.name} onChange={e => setCharForm({...charForm, name: e.target.value})} /></Grid><Grid item xs={12} md={4}><TextField label="Persona" fullWidth size="small" value={charForm.persona} onChange={e => setCharForm({...charForm, persona: e.target.value})} /></Grid><Grid item xs={12} md={3}><TextField label="Avatar URL" fullWidth size="small" value={charForm.avatar} onChange={e => setCharForm({...charForm, avatar: e.target.value})} /></Grid><Grid item xs={12} md={2}><Select fullWidth size="small" value={charForm.role} onChange={e => setCharForm({...charForm, role: e.target.value as any})}><MenuItem value="expert">Expert</MenuItem><MenuItem value="learner">Learner</MenuItem></Select></Grid><Grid item xs={12}><Button variant="contained" fullWidth startIcon={<PersonAdd />} onClick={addOrUpdateCharacter}>{editCharId ? 'Update' : 'Add'} Character</Button></Grid></Grid><List dense sx={{ bgcolor: '#f8f8f8', borderRadius: 1 }}>{characters.map(c => (<ListItem key={c.id} divider><Avatar src={c.avatar || undefined} sx={{ mr: 2 }} /><ListItemText primary={`${c.name} (${c.role})`} secondary={c.persona} /><ListItemSecondaryAction><IconButton size="small" onClick={() => { setEditCharId(c.id); setCharForm({ name: c.name, persona: c.persona, avatar: c.avatar || '', role: c.role }); }}><ChatBubbleOutline fontSize="small" /></IconButton><IconButton size="small" color="error" onClick={() => deleteChar(c.id)}><Delete fontSize="small" /></IconButton></ListItemSecondaryAction></ListItem>))}</List></Box>}
          {settingsTab === 2 && <Box sx={{ py: 2 }}><Grid container spacing={2} sx={{ mb: 3 }}><Grid item xs={12} md={5}><TextField label="Name" fullWidth size="small" value={newSourceName} onChange={e => setNewSourceName(e.target.value)} /></Grid><Grid item xs={12} md={5}><TextField label="URL" fullWidth size="small" value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)} /></Grid><Grid item xs={12} md={2}><Button variant="contained" fullWidth startIcon={<Add />} onClick={addSource}>Add</Button></Grid></Grid><List dense sx={{ bgcolor: '#f8f8f8', borderRadius: 1 }}>{sources.map(s => (<ListItem key={s.id} divider><ListItemText primary={s.name} secondary={s.url} /><ListItemSecondaryAction><IconButton size="small" color="error" onClick={() => deleteSource(s.id)}><Delete fontSize="small" /></IconButton></ListItemSecondaryAction></ListItem>))}</List></Box>}
          {settingsTab === 3 && (
            <Box sx={{ py: 2 }}>
              <List dense sx={{ bgcolor: '#fff0f0', borderRadius: 1 }}>
                {failedProcesses.length > 0 ? failedProcesses.map(err => (
                  <React.Fragment key={err.id}>
                    <ListItem 
                      divider 
                      sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#ffebeb' } }}
                      onClick={() => setExpandedError(expandedError === err.id ? null : err.id)}
                    >
                      <ListItemText 
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            {err.phase && (
                              <Chip 
                                label={err.phase} 
                                size="small" 
                                color={err.phase === 'CRAWL' ? 'warning' : err.phase === 'EVAL' ? 'secondary' : 'default'} 
                                sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold' }}
                              />
                            )}
                            <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                              {err.error_message}
                            </Typography>
                          </Box>
                        } 
                        secondary={
                          <Box component="span">
                            {err.context && <Typography variant="caption" display="block" color="text.primary" sx={{ fontStyle: 'italic', mb: 0.5 }}>{err.context}</Typography>}
                            <Typography 
                              variant="caption" 
                              component="a" 
                              href={err.url} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              onClick={(e) => e.stopPropagation()}
                              color="primary" 
                              sx={{ display: 'block', textDecoration: 'none', '&:hover': { textDecoration: 'underline' }, mb: 0.5 }}
                            >
                              {err.url}
                            </Typography>
                            <Typography variant="caption" display="block" color="text.secondary">
                              {new Date(err.created_at).toLocaleString()}
                            </Typography>
                          </Box>
                        } 
                      />
                      <ListItemSecondaryAction>
                        <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); retryError(err.id); }} title="Retry"><Refresh fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); deleteError(err.id); }} title="Delete"><Delete fontSize="small" /></IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                    {expandedError === err.id && (
                      <Box sx={{ p: 2, bgcolor: '#333', color: '#fff', fontSize: '0.75rem', overflowX: 'auto', borderRadius: '0 0 4px 4px' }}>
                        <Typography variant="caption" display="block" sx={{ opacity: 0.7, mb: 1 }}>Raw Stack Trace:</Typography>
                        <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {err.stack_trace || 'No stack trace available'}
                        </Box>
                      </Box>
                    )}
                  </React.Fragment>
                )) : <Typography sx={{ p: 2, textAlign: 'center' }}>No failed processes</Typography>}
              </List>
            </Box>
          )}
        </DialogContent>
        <Box sx={{ p: 2, textAlign: 'right' }}><Button onClick={() => { setSettingsOpen(false); saveConfig(); fetchInitialData(); }} color="primary" variant="contained">Close & Save</Button></Box>
      </Dialog>
      <Dialog open={errorOpen} onClose={() => setErrorOpen(false)} maxWidth="md" fullWidth><DialogTitle>Error</DialogTitle><DialogContent sx={{ bgcolor: '#fff0f0' }}><Typography variant="body2">{status.lastError}</Typography></DialogContent></Dialog>
      
      <Dialog open={!!retryErrorDetail} onClose={() => setRetryErrorDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip label="!" color="error" size="small" /> Retry Failed
        </DialogTitle>
        <DialogContent sx={{ bgcolor: '#fff0f0', pt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>Reason:</Typography>
          <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{retryErrorDetail}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRetryErrorDetail(null)}>Close</Button>
        </DialogActions>
      </Dialog>

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

      <Dialog open={ingestOpen} onClose={() => setIngestOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Manual URL Ingestion</DialogTitle>
        <DialogContent>
          <TextField 
            autoFocus
            label="Article URL" 
            fullWidth 
            sx={{ my: 2 }} 
            value={ingestUrl} 
            onChange={e => setIngestUrl(e.target.value)} 
            placeholder="https://example.com/article"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIngestOpen(false)}>Cancel</Button>
          <Button onClick={ingestUrlAction} variant="contained" disabled={ingesting || !ingestUrl}>
            {ingesting ? <CircularProgress size={24} /> : 'Ingest'}
          </Button>
        </DialogActions>
      </Dialog>

      <Zoom in={trigger}>
        <Fab
          color="primary"
          size="small"
          onClick={scrollToTop}
          sx={{
            position: 'fixed',
            bottom: 32,
            right: 32,
            boxShadow: 3,
            '&:hover': {
              transform: 'scale(1.1)',
            },
          }}
          aria-label="scroll back to top"
        >
          <KeyboardArrowUp />
        </Fab>
      </Zoom>
    </Box>
  );
}
