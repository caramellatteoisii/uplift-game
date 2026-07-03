# 顧客を救え！🎯

アップリフトモデリングを体験しながら学べるブラウザゲームです。

## ゲーム概要

「購入確率が高い顧客を選ぶ」ではなく、「施策によって行動が変わる顧客を選ぶ」というアップリフトモデリングの本質を、ゲームを通じて体験できます。

### 4つの顧客タイプ

| タイプ | 施策あり | 施策なし | スコア |
|---|---|---|---|
| 🎯 Persuadable | 購入 | 未購入 | +100点 |
| ✅ Sure Thing | 購入 | 購入 | +20点 |
| 😶 Lost Cause | 未購入 | 未購入 | 0点 |
| ⚠️ Sleeping Dog | 未購入 | 購入 | -100点 |

## セットアップ

```bash
# 依存パッケージのインストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# ビルド結果のプレビュー
npm run preview
```

## 技術スタック

- React 18
- TypeScript
- Vite
- Tailwind CSS

## Vercelへのデプロイ

1. このリポジトリを GitHub に push する
2. [Vercel](https://vercel.com) でリポジトリを Import する
3. Framework Preset: **Vite** を選択
4. Deploy ボタンを押すだけで完了

## ディレクトリ構成

```
uplift-game/
├── public/
│   └── favicon.svg
├── src/
│   ├── App.tsx        # ゲーム本体（全コンポーネント）
│   ├── main.tsx       # Reactエントリーポイント
│   └── index.css      # Tailwind CSS
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── vercel.json
└── .gitignore
```
