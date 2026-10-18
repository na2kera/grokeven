# Phase 0 接続検証報告

検証日: 2026-10-18 〜 2026-10-19
結論: **既存マスター Bot（オギコ）への外部入力と回答取得の経路は成立した。** Phase 1 以降へ進める。

## 確定した接続経路

```
G2 アプリ ──(Bearer DEVICE_TOKEN)──▶ Workers POST /v1/requests ──▶ D1 保存
                                        │
                                        ▼ routine-webhook アダプター
                        Grok Bot ルーチン「G2テスト」の Webhook URL（api2.cursor.sh、Authorization: Bearer <key>）
                                        │
                                        ▼ オギコが会話内で処理
                        Bot のコンピューターから POST /v1/bot-results
                        （Authorization: Bearer <依頼ごとの result_token>、User-Agent: grokeven-bot/1.0）
                                        │
                                        ▼
G2 アプリ ◀──(2 秒ポーリング)── Workers GET /v1/requests/{id} ◀── D1（status=completed, answer）
```

## 完了条件と結果

| 条件 | 結果 | 根拠 |
| --- | --- | --- |
| 対象が既存マスター Bot であること | 成立 | ルーチンはオギコが所有し、実行・回答がオギコの会話に記録される |
| 回答をプログラムで取得できること | 成立 | g2test-004〜006 で `GET /v1/requests/{id}` が `completed` と回答本文を返した |
| 追加質問の文脈の扱いを説明できること | 成立 | 別実行でも Bot の記憶で前の内容（合言葉）を参照できた。同一会話の全文継続は保証されない（Bot 記憶ベース） |

## 計測

| 項目 | 値 |
| --- | --- |
| 依頼作成 → 回答保存（短い質問） | 11〜19 秒 |
| Bot の承認プロンプト | 発生なし（外向き HTTPS も承認なしで実行） |
| 安全チェックによる停止 | 発生なし（今後、内容により発生しうる） |

## 利用者が行った設定

1. Grok Bot（Mac アプリ）でオギコにチャットで依頼し、Webhook 起動のルーチン「G2テスト」を作成
2. ルーチン画面で起動 URL とキーを取得し、`.dev.vars` / Workers Secrets に登録
3. ルーチン指示を更新: `text` に回答し、`result_url` に `{request_id, answer}` を `Authorization: Bearer <result_token>` と `User-Agent: grokeven-bot/1.0` 付きで POST。送信先は `grokeven-production.na2kera.workers.dev` に限定。失敗時は 1 回だけ再送。承認なしで実行

## 判明した制約

- **公式資料に記載のない機能に依存している。** Bot ルーチンの Webhook 起動は docs.x.ai に記載がなく、Cursor 基盤（api2.cursor.sh）のエンドポイント。仕様変更の可能性がある
- **Cloudflare の Bot 対策**: Bot が Python 標準 User-Agent で送ると 1010 で拒否される。独自 User-Agent で回避
- **承認・安全チェック**: Bot の外向き送信には毎回自動安全チェックがかかる。停止した場合 Bot はチャットに報告するが、Workers には通知が来ないため `awaiting_approval` を観測できない。利用者が公式アプリで確認する運用
- **会話継続**: アプリ側 conversation_id と Grok 側会話は対応しない。文脈は Bot の記憶に依存し、全文引き継ぎは保証されない
- **キャンセル不可**: 依頼の打ち切り（abandon）は中継側の枠解放のみ。Bot の処理は止まらない
- **ルーチンの指示が接続仕様の一部**: 指示文を変えると動作が変わる。指示文は本リポジトリに控えを置く（docs/routine-instruction.md）

## 残課題（Phase 1 以降）

- 120 秒超の長時間処理、安全チェック停止時の挙動は未観測
- 重複コールバック（Bot の再送）は単体テストでのみ確認
- Even Hub WebView のオリジン（ALLOWED_ORIGINS）は未設定
