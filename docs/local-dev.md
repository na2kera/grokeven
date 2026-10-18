# ローカル起動・検証手順

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

## Phase 0 チェック #2: ルーチン Webhook へ 1 件送る

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
