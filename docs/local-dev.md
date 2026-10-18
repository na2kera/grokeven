# ローカル起動・検証手順

リポジトリは npm workspaces 構成: `apps/relay`（Cloudflare Workers + D1）と `apps/glasses`（Even Hub G2 アプリ）。ルートで `npm install` すると両方入る。

## apps/glasses（G2 アプリ）

```
npm run glasses -- dev        # Vite dev server (http://localhost:5173)
npm run glasses -- simulate   # Even Hub シミュレーター
npm run glasses -- test       # vitest（レイアウト・状態機械の単体テスト）
npm run glasses -- build      # tsc + vite build
npm run glasses -- pack       # .ehpk 作成（evenhub pack）
```

初回はスマホ側画面（Even アプリ内のページ）で中継 URL と端末トークンを保存する。トークンは `apps/relay/.dev.vars.production` の `DEVICE_TOKEN`。

## apps/relay（中継 API）

以下は `apps/relay` 内で実行する（またはルートから `npm run relay -- <script>`）。

## 前提

- Node 22（`volta` で `package.json` の `volta.node` が自動適用される）
- `npm install`

## 設定

1. `.dev.vars.example` を `.dev.vars` にコピーし値を埋める（git 管理外）
2. `wrangler.jsonc` の `BOT_ADAPTER`
   - `manual`: Bot には何も送らない。`POST /v1/requests` の応答に `manual_dispatch`（result_url, result_token）が付くので、それを手動でルーチンに送る
   - `routine-webhook`: 依頼作成時に `ROUTINE_WEBHOOK_URL` へ POST する（認証方式は検証後に確定）

## 起動

```
npm run db:migrate:local
npm run dev        # http://localhost:8787
npm test           # vitest (workers pool)
npm run typecheck
```

### Phase 0 チェック #2: ルーチン Webhook へ 1 件送る

```
node scripts/send-to-routine.mjs "今日の東京の天気は？" test-001
# 既定は Standard Webhooks 署名。AUTH_MODE=bearer / header / none も可
```

## API（MVP）

| メソッド・パス | 認証 | 用途 |
| --- | --- | --- |
| POST /v1/requests | Bearer DEVICE_TOKEN | 依頼作成。202 + request_id。同じ client_request_id は既存を 200 で返す。未完了が 1 件あれば 409 |
| GET /v1/requests/{id} | Bearer DEVICE_TOKEN | 状態・回答取得 |
| POST /v1/bot-results | Bearer 依頼ごとの result_token | Bot からの回答投稿 `{request_id, answer}`。同一回答の再送は 200、異なる回答は 409 |

## Even Hub への導入（実機）

1. `npm run glasses -- pack` → `apps/glasses/grokeven.ehpk` ができる（git 管理外）
2. Even アプリの開発者メニュー（Private Testing）から `.ehpk` を読み込む。または開発中は `npm run glasses -- dev` を起動し、`npx evenhub qr` で表示される QR をスマホの Even アプリで読み取ってサイドロードする
3. スマホ側画面で中継 URL（既定値のまま）と端末トークン（`apps/relay/.dev.vars.production` の `DEVICE_TOKEN`）を保存し、「接続テスト」で `origin=...` を確認する
   - ここで出た Origin を `apps/relay/wrangler.jsonc` の `ALLOWED_ORIGINS`（現在 `*`）に絞り込む
4. グラス側: タップで固定文を送信 → 待機 → 回答。スワイプでページ、タップで新しい質問、2 回タップで終了・中断

注意: `app.json` の `name`（現在 "Bot Relay"）は未決定。Even Hub の審査規則で "Even" を含めてはならない（docs/phase0-research.md 参照）。
