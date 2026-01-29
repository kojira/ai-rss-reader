# AI RSS Reader 🦤

AIを活用した次世代RSSリーダー。単に記事を集めるだけでなく、LLM（Large Language Model）が内容を分析・評価し、あなたの関心に合った情報を抽出します。

## 🌟 主な機能

- **自動記事収集**: 登録したRSSフィードから定期的に記事を取得
- **AI重要度評価**: LLMが5つの評価軸（新規性、重要度、信頼性、文脈価値、思考刺激性）で記事をスコアリング
- **日本語要約**: 海外記事も自動的に翻訳・要約（約1000文字の詳報と100文字の要約）
- **Discord通知**: 高スコアの記事や新着記事をリアルタイムでDiscordチャットに通知
- **直感的なUI**: Next.js、MUI、Rechartsを利用したモダンなダッシュボード

## 🧠 AI評価ロジック

`src/lib/llm/evaluator.ts` にて、以下の5段階評価を行っています：

1. **novelty (新規性)**: 情報の鮮度。
2. **importance (重要度)**: 社会的影響。
3. **reliability (信頼性)**: ソースの信頼性。
4. **contextValue (文脈価値)**: 技術的・実用的な価値。
5. **thoughtProvoking (思考刺激性)**: 新たな視点。

平均スコアに基づいたフィルタリングにより、ノイズの少ない情報収集が可能です。

## 🛠 セットアップ

### 必要条件

- Node.js (v20以上推奨)
- pnpm (推奨)
- OpenRouter APIキー (AI評価に使用)
- Discord Webhook URL (通知に使用)

### インストール

```bash
cd ai-rss-reader
pnpm install
```

### 設定

`.env` ファイル（またはGUI上の設定画面）で以下を設定してください：
- OpenRouter API Key
- Discord Webhook URL

## 🚀 使い方

### 開発モードの起動（Web UI）

```bash
pnpm dev
```
ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

### クローラー（バックグラウンドワーカー）の実行

記事の収集とAI評価を開始します：

```bash
pnpm worker
```

## 🏗 アーキテクチャ

- **Frontend**: Next.js (App Router), React, MUI, Recharts
- **Backend**: Next.js API Routes, Better-SQLite3
- **Crawler**: Playwright, Cheerio, RSS-Parser
- **AI**: Gemini 2.0 via OpenRouter
- **Notification**: Discord Webhook

## 📝 開発状況

このプロジェクトは現在活発に開発中です。🦤
