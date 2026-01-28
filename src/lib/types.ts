export interface CrawledArticle {
  url: string;
  originalUrl: string;
  title: string;
  content: string;
  pubDate: string | undefined;
}

export interface EvaluationResult {
  translatedTitle: string;
  summary: string;
  shortSummary: string;
  scores: {
    novelty: number;
    importance: number;
    reliability: number;
    contextValue: number;
    thoughtProvoking: number;
  };
  averageScore: number;
}
