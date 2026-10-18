# ルーチン「G2テスト」の指示（控え）

Grok Bot 側に保存されている指示の要約。変更したらここも更新する。

- トリガー: Webhook が発火したとき
- 入力 JSON: `text`, `request_id`, `result_url`, `result_token`
- 処理:
  1. `text` を質問として処理し回答を作る
  2. `result_url` に `POST`。ヘッダー `Authorization: Bearer <result_token>`、`Content-Type: application/json`、`User-Agent: grokeven-bot/1.0`。本文 `{"request_id": "...", "answer": "..."}`
  3. HTTP ステータスと応答本文を会話に短く報告。`result_token` の値は書かない
  4. 承認を待たずに POST。失敗時は 1 回だけ再送し、それでも失敗したら報告
  5. `result_url` のホストが `grokeven-production.na2kera.workers.dev` のときだけ送る。別ホストならトークンを送らず報告
- `text` または `request_id` が欠けている、JSON として読めない場合は会話に報告
