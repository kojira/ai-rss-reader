import axios from 'axios';
import { CrawledArticle, EvaluationResult } from '../types';
import { DAO } from '../db/index';

export async function sendDiscordNotification(article: CrawledArticle, evaluation: EvaluationResult) {
  const config = DAO.getConfig();
  if (!config.discord_webhook_url) return;

  if (evaluation.averageScore < config.score_threshold) return;

  const embed = {
    title: evaluation.translatedTitle,
    url: article.url,
    description: evaluation.shortSummary,
    fields: [
      {
        name: 'Scores',
        value: `Avg: **${evaluation.averageScore.toFixed(2)}**\n(N:${evaluation.scores.novelty} I:${evaluation.scores.importance} R:${evaluation.scores.reliability} C:${evaluation.scores.contextValue} T:${evaluation.scores.thoughtProvoking})`,
        inline: true
      },
      {
        name: 'Original Link',
        value: `[Link](${article.originalUrl})`,
        inline: true
      }
    ],
    color: 0x00ff00,
    timestamp: new Date().toISOString(),
    image: article.imageUrl ? { url: article.imageUrl } : undefined
  };

  try {
    await axios.post(config.discord_webhook_url, {
      embeds: [embed]
    });
  } catch (e) {
    console.error('Discord notification failed:', e);
  }
}
