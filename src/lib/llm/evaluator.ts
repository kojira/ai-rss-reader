import axios from 'axios';
import { CrawledArticle, EvaluationResult } from '../types';
import { DAO } from '../db/index';

export async function evaluateArticle(article: CrawledArticle): Promise<EvaluationResult | null> {
  const config = DAO.getConfig();
  if (!config.open_router_api_key) {
    console.error('OpenRouter API Key is missing');
    return null;
  }

  const prompt = `
以下の記事を評価し、指定されたフォーマットのJSONで出力してください。

記事タイトル: ${article.title}
記事本文: ${article.content.slice(0, 5000)}

評価軸(1-5点):
1. novelty (新規性): 情報の鮮度。
2. importance (重要度): 社会的影響。
3. reliability (信頼性): ソースの信頼性。
4. contextValue (文脈価値): 技術的・実用的な価値。
5. thoughtProvoking (思考刺激性): 新たな視点。

出力フォーマット:
{
  "translatedTitle": "日本語に訳したタイトル",
  "summary": "1000文字程度の要約",
  "shortSummary": "Discord通知用の100文字程度の短い要約",
  "scores": {
    "novelty": 5,
    "importance": 4,
    "reliability": 4,
    "contextValue": 3,
    "thoughtProvoking": 5
  }
}
`;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-001', // Default fast model
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${config.open_router_api_key}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const result = JSON.parse(response.data.choices[0].message.content);
    const scores = result.scores;
    const averageScore = (scores.novelty + scores.importance + scores.reliability + scores.contextValue + scores.thoughtProvoking) / 5;

    return {
      ...result,
      averageScore
    };
  } catch (e) {
    console.error('LLM Evaluation failed:', e);
    return null;
  }
}
