import axios from 'axios';
import { CrawledArticle, EvaluationResult } from '../types';
import { DAO } from '../db/index';

export async function evaluateArticle(article: CrawledArticle): Promise<EvaluationResult> {
  const config = DAO.getConfig();
  if (!config.open_router_api_key) {
    throw new Error('OpenRouter API Key is missing');
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
        },
        timeout: 30000
      }
    );

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error(`LLM response structure invalid: ${JSON.stringify(response.data)}`);
    }

    const result = JSON.parse(response.data.choices[0].message.content);
    if (!result.scores || typeof result.scores.novelty !== 'number') {
      throw new Error(`LLM returned invalid result structure: ${response.data.choices[0].message.content}`);
    }

    const scores = result.scores;
    const averageScore = (scores.novelty + scores.importance + scores.reliability + scores.contextValue + scores.thoughtProvoking) / 5;

    return {
      ...result,
      averageScore
    };
  } catch (e: any) {
    console.error('LLM Evaluation failed:', e.message);
    throw e;
  }
}

export async function generateDialogue(article: any, length: string = 'medium'): Promise<any[] | null> {
  const config = DAO.getConfig();
  const characters = DAO.getCharacters();
  const charA = characters.find(c => c.role === 'expert') || characters[0];
  const charB = characters.find(c => c.role === 'learner') || characters[1];

  if (!config.open_router_api_key || !charA || !charB) {
    console.error('Missing config or characters');
    return null;
  }

  const lengthMap: Record<string, string> = {
    short: '5-8 lines',
    medium: '10-15 lines',
    long: '20-25 lines'
  };
  const lengthStr = lengthMap[length] || '10-15 lines';

  const prompt = `Create a dialogue script in Japanese between two characters based on the news article:
Expert ${charA.name} (Persona: ${charA.persona})
Learner ${charB.name} (Persona: ${charB.persona})

Topic: ${article.translated_title || article.original_title}
Summary: ${article.summary}

Requirements:
- MANDATORY: MUST be a back-and-forth conversation between ${charA.name} and ${charB.name}.
- Length: approximately ${lengthStr}.
- Tone: Natural and engaging Japanese.
- Output MUST be a valid JSON array of objects.

Output Format:
[
  {"speaker": "${charA.name}", "text": "..."},
  {"speaker": "${charB.name}", "text": "..."},
  ...
]
`;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-001',
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

    let content = response.data.choices[0].message.content;
    content = content.replace(/```json\n?|\n?```/g, '').trim();

    let scripts: any;
    try {
      scripts = JSON.parse(content);
    } catch (parseError) {
      console.error('Initial JSON parse failed, trying fallback:', content);
      const arrayMatch = content.match(/\[\s*\{.*\}\s*\]/s);
      if (arrayMatch) {
        scripts = JSON.parse(arrayMatch[0]);
      } else {
        throw parseError;
      }
    }

    const arr = Array.isArray(scripts) ? scripts : (scripts.script || scripts.dialogue || []);
    return arr.length > 0 ? arr : null;
  } catch (e) {
    console.error('Dialogue generation failed:', e);
    return null;
  }
}
