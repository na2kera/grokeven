# Phase 0 調査メモ（2026-10-18 時点・未検証）

公式資料の読み取り結果のみ。実アカウントでの動作確認は未実施。

## 利用環境（ユーザー申告）

- Grok Bot は Cursor Pro プランに付帯するもの（Cursor が課金・アカウント基盤。Bot のコンピュータは Cursor のクラウドで動作）
- Bot へのルーチン・連携の追加は可
- 会話継続は「Bot の記憶で文脈が通れば合格」
- コストは既存プラン範囲内なら可。追加課金は都度相談

## 公式資料で確認できた外部入力経路

| 経路 | 内容 | 本プロジェクトでの評価 |
| --- | --- | --- |
| X で @bot をタグ | X の投稿・返信を自分の Bot にタスクとして渡す。結果は Bot アプリ内の会話に残り、X には確認のみ投稿 | 公開投稿が必要。プログラムからの回答取得手段なし。不採用候補 |
| ルーチンのイベントトリガー | 「Cursor アカウント連携が Slack メッセージや GitHub 通知などのイベントからルーチンを起動できる」とだけ記載。設定方法・形式は未記載 | 最有力候補だが設定画面での実在確認が必要 |
| Automations Webhook | Grok「Automation」を起動する。Standard Webhooks 署名、202 Accepted。Bot については一切言及なし | Automation と Bot の関係が未確認。単独では既存 Bot に届く根拠なし |
| メール / Telegram / 汎用 API | 記載なし | 不明 |

出典:
- https://docs.x.ai/grok-bot/overview
- https://docs.x.ai/grok-bot/skills-routines-and-automations
- https://docs.x.ai/grok-bot/tag-on-x
- https://docs.x.ai/grok/automations/webhooks
- https://cursor.com/help/grok-bot/plans

## 公式資料で確認できた回答取得経路

- ポーリング API、コールバック URL、結果 Webhook、Bot からの HTTP 送信ツール: いずれも記載なし
- 結果は Bot アプリ内の会話に残る。モバイル通知あり
- Bot が作成したメール / Slack メッセージの送信はアプリ内でユーザー確認が必要（ドラフト方式）。ルーチン実行時に自動送信できるかは未記載

## 会話 ID・記憶

- 外部入口向けの会話 ID / セッション ID は記載なし
- 記憶は Bot 単位で永続（「named Bot keeps its memory, files, browser sessions, and preferences across sessions」）
- 合格ライン「Bot の記憶で文脈が通る」は、記憶が Bot 単位である以上、成立する見込みはある。要実機確認

## 未読の公式ページ（次に確認）

- https://docs.x.ai/grok-bot/get-started
- https://docs.x.ai/grok-bot/bots
- https://docs.x.ai/grok-bot/settings-and-notifications
- https://docs.x.ai/grok-bot/approvals-security-and-privacy
- https://docs.x.ai/grok-bot/files-and-results
- https://docs.x.ai/grok-bot/troubleshooting

## 現時点の結論

公式資料には「外部プログラムから既存 Bot に依頼を送り、回答をプログラムで受け取る」経路は明記されていない。
Phase 0 は、Grok Bot アプリの設定画面（Connect apps / ルーチンのトリガー一覧 / Automation）を実際に開き、何が選べるかを確認することから始める必要がある。

## 追記（同日）: ルーチンの作成方法と有力経路

- ルーチンは Bot にチャットで依頼して作成する（専用作成画面なし）。管理は Mac アプリで「会話の詳細を表示」→「ルーチン」。iPhone は閲覧・一時停止・削除のみ
- トリガーは「スケジュール」と「イベント」。イベントの例は Slack メッセージ・GitHub 通知のみ。Cursor アカウント連携によるもので、マーケットプレイスの Slack/GitHub プラグインとは別と明記
- Webhook / HTTP / メール受信 / カスタム MCP をユーザーが Bot に追加する手段は Bot 資料に記載なし
- ユーザー環境: Mac と iPhone の両方で利用。Connect apps で Notion が接続済み

### 有力経路（Slack イベントルーチン案、未検証）

1. G2 → Workers → 専用 Slack チャンネルへ投稿（Workers が持つ Slack bot token）
2. マスター Bot のイベントルーチンが起動し、Bot の会話内で処理
3. Bot が Slack 同スレッドへ回答投稿
4. Slack Events API → Workers → D1 → G2 ポーリング

要検証: (a) イベントルーチンがユーザーのアカウントで作成できるか、(b) ルーチン内の Bot が承認なしで Slack 投稿できるか、(c) 回答と request_id の対応付け（スレッド ts を利用する想定）
代替: GitHub 通知（Issue 作成）トリガー + Issue コメントで回答 + GitHub Webhook

## 決定（同日）: GitHub トリガーを採用

ユーザー判断により、Phase 0 の検証経路は GitHub 通知トリガーを採用する（Slack ワークスペース不要のため）。

想定フロー:
1. G2 → Workers → 専用プライベートリポジトリに Issue を作成（Workers が持つ GitHub token。本文に request_id を含める）
2. マスター Bot のイベントルーチンが Issue 作成で起動し、Bot の会話内で処理
3. Bot が同 Issue にコメントで回答を投稿
4. GitHub Webhook（issue_comment）→ Workers → D1 → G2 ポーリング

要検証は Slack 案と同じ: (a) GitHub イベントルーチンが作成できるか、(b) ルーチン内の Bot が承認なしで Issue コメントできるか、(c) Issue 番号 ↔ request_id の対応付け

## 実機確認 1（同日）: ルーチン画面

- マスター Bot の名前は「オギコ」
- Bot の詳細パネル「詳細」タブにルーチン欄あり。既存ルーチンはゼロ
- 画面の説明文は「ルーチンは、この Bot がスケジュールに沿って実行する繰り返しのタスクです。チャットで設定を依頼してください。」
  - 「スケジュール」のみ言及。イベントトリガーの文言はこの画面にはない
  - 作成 UI は存在せず、チャットで依頼する方式であることを実機で確認

## 実機確認 2（同日）: オギコへの質問の返答（Bot の自己申告、要実証）

質問: GitHub Issue 作成で起動するルーチンを作れるか / イベント起動の対応範囲 / 承認なしでコメント投稿できるか

返答の要点:
- GitHub イベント起動は PR 作成・マージ、レビュー、CI、Issue アサインに対応。「Issue 作成」イベントは未提供
- 代替 3 案: (1) Issue アサインで起動、(2) 定期チェック（1 時間ごと等）、(3) **Webhook で起動: ルーチン専用 URL を発行し、外部からそこへ送る**。GitHub 署名方式との整合は未確認とのこと
- コメント投稿: ルーチン指示に明記すれば毎回の承認は不要。ただし投稿ごとに自動安全チェックがあり、内容により停止して確認を求めることがある
- コメントがユーザー名で付くかアプリ名で付くかは未確認
- GitHub は Cursor アカウントに接続済み

### 評価

- 「ルーチン専用 Webhook URL」が実在すれば、GitHub Issue を入力に使う必要がなくなる。Workers から直接ルーチンを起動できる
- 回答の戻し方は別途必要。候補: (a) Workers が事前に作った GitHub Issue にコメント → GitHub Webhook、(b) Bot のコンピューターから Workers の結果投稿 API へ HTTP POST（承認・通信制約を要確認）
- Bot の返答は自己申告であり、公式資料には Bot ルーチンの Webhook 起動は記載がない。実際にルーチンを作って URL を得るまで成立扱いにしない

### 次の検証

1. オギコに Webhook 起動のテストルーチンを作ってもらい、発行 URL・認証方式（署名/トークン）・受け取れるペイロード形式を確認する
2. PC から curl で 1 件送り、ルーチンが起動して Bot の会話に処理が現れるか確認する
3. 回答の戻し方 (a)/(b) を順に試す

## Codex レビュー要約（同日）と確定方針

方針: 入力は ルーチン Webhook、出力は (a) Bot からの HTTP POST を第一候補。(a) が不可なら (b) GitHub Issue コメント。

### 検証チェックリスト（順序固定）

| # | 検証 | 合格基準 |
|---|---|---|
| 1 | テストルーチン作成 | オギコにひも付く URL・認証・メソッド・入力形式を取得。説明だけ／別 Bot・別機能は不合格 |
| 2 | PC から固有の質問 + request_id を送信 | オギコの実行を確認し両方が届く。無認証・誤認証では起動しない |
| 3 | (a) HTTP POST 出力 | 人手なしで固定 Workers URL に認証付き POST が届き ID と回答が一致。外向き通信不可／毎回承認なら (b) へ |
| 4 | 結果受信の認証 | ID のみ・誤トークン・別依頼トークン・期限切れを拒否。回答の上書き不可 |
| 5 | 必要なら (b) | 事前作成 Issue に承認なし投稿、検証済み Webhook から一度だけ保存 |
| 6 | 反復・障害 | 複数往復、二件目拒否、重複通知無害、120 秒後の回答も保存。承認停止を完了扱いしない |
| 7 | 追加質問 | 同じオギコに届き、文脈継続範囲を説明できる |

### /v1/bot-results 認証設計（Codex 案を採用）

- 依頼ごとに乱数トークンを発行し request_id・有効期限にひも付け。保存はハッシュ。送信は `Authorization: Bearer`
- 端末用トークンとは分離。URL クエリ・通常ログに秘密を出さない
- 認証確認・回答保存・使用済み化を原子的に処理。同一回答の再送は成功扱いで無変更、異なる回答は拒否
- 有効期限は画面の 120 秒待機とは別に、遅延回答を受け取れる長さにする

## チェック #1・#2 結果（2026-10-18 夜）

- #1 合格: 「G2テスト」ルーチン（トリガー「Webhookが発火したとき」）が実在。起動 URL・キーは Mac アプリのルーチン画面で取得可能
- #2 送信: PC から `node scripts/send-to-routine.mjs` で 1 件送信（request_id=g2test-001）
  - エンドポイントのホストは `api2.cursor.sh`（Cursor 基盤）。認証は `Authorization: Bearer <key>`
  - 応答: `HTTP 200` `{"success":true,"runUuid":"..."}`。**run の UUID が返る**ため、`external_run_ref` に保存できる
  - 応答は受付の成功であり、Bot の処理完了ではない（仕様 §3.2 どおり）。オギコの会話への投稿を確認して #2 の合否を判定する
- **#2 合格**: 送信直後にオギコの会話へ「request_id: g2test-001」「ok」が投稿された。JSON の `text` / `request_id` が正しく Bot に渡っている

## 本番デプロイと自動送信（同日）

- Workers `grokeven-production` を本番デプロイ（URL: https://grokeven-production.na2kera.workers.dev）。D1 `grokeven` 作成・マイグレーション適用・シークレット登録済み
- 本番 `POST /v1/requests`（client_request_id=g2test-002）→ Workers が routine-webhook アダプターで自動送信 → オギコの会話に「request_id: 03e37c1e-...」「ok2」が即時投稿された
- Bot は JSON 内の `result_url` / `result_token` を認識したが、当時のルーチン指示「外部には投稿しない」に従い未使用。指示更新で利用できる見込み
- 次: ルーチン指示を更新し、`result_url` へ `Authorization: Bearer <result_token>` 付きで `{request_id, answer}` を POST させる（チェック #3）

## チェック #3 途中経過（同日）: Bot → Workers の POST が Cloudflare 1010 で拒否

- ルーチン更新後、g2test-003（request_id e0930bd7-...）で Bot は回答「ok3」を生成し、送信先の許可チェック（Bot 側で workers.dev のホストに限定）も通過
- しかし result_url への POST が HTTP 403 / Cloudflare error 1010。1 回再送も同じ
- 再現: `Python-urllib/3.12` の User-Agent だけ 403。`python-requests`、`curl`、独自 UA は Worker まで届く（401 = トークン検証に到達）
- 対処: ルーチン側で `User-Agent: grokeven-bot/1.0` を付けて送る。Cloudflare 側の設定変更は不要
- 副産物: Bot のコンピューターからの外向き HTTPS 送信は**承認なしで実行された**（安全チェックは通過）。チェック #3 の主要論点はこの時点でほぼ成立

## チェック #3・#4 合格（同日）

- g2test-004（request_id a4fcafcf-...）: `POST /v1/requests` → ルーチン Webhook → Bot 回答 → Bot が `User-Agent: grokeven-bot/1.0` 付きで `POST /v1/bot-results` → D1 保存 → `GET /v1/requests/{id}` が `completed` / `answer: "ok4"`
- 所要時間: 依頼作成から completed まで **19 秒**（承認なし）
- #4: 結果投稿はトークン必須（トークンなし・誤トークン・他依頼のトークン・期限切れはテストで 401 を確認。本番でもトークンなしは 401）

### Phase 0 の成立状況

| 完了条件 | 状態 |
| --- | --- |
| 対象が既存マスター Bot（オギコ）であること | 成立（オギコの会話に実行が記録される） |
| 回答をプログラムで取得できること | 成立 |
| 追加質問の文脈の扱いを説明できること | #7 で検証中 |

## チェック #7 合格（2026-10-19）

- g2test-005「合言葉は『紫のカワウソ』。覚えて」→ 16 秒で「了解」
- g2test-006「さっきの合言葉は？」→ 11 秒で「紫のカワウソ」
- 別々の Webhook 起動（別ルーチン実行）でも、同じ Bot の会話で前の内容を参照できた。合格ライン「Bot の記憶で文脈が通る」を満たす
- Bot 側の報告: 1 回目の POST で HTTP 200、再送なし

## Phase 1 最小確認（2026-10-19、本番）

| 検証 | 結果 |
| --- | --- |
| 120 秒超の回答（p1-long-001「180 秒待ってから答えて」） | 合格。200 秒で completed、answer=ok-late。トークン TTL 1800 秒内。Bot 側も 1 回目の POST で 200 |
| 打ち切り後の遅延回答と新規依頼（p1-abandon-001 / p1-after-abandon-001） | 合格。abandon で failed になり枠が解放、直後の新規依頼は 12 秒で completed。打ち切った依頼にも後から answer=ok-abandon が保存された |
| 重複コールバック（p1-dup-001、依頼本文で「同じ POST を 2 回送って」と指示） | Bot は 2 回目を送らず、「保存済みの手順では再送は失敗時の 1 回だけ」と報告。**依頼本文でルーチンの送信手順を上書きできない**ことが確認できた（安全面で望ましい）。本番での重複受信は未観測。重複の扱い（同一回答 200 + duplicate:true、異なる回答 409）は単体テストで確認済み |

補助スクリプト: `scripts/ask.sh <client_request_id> "<text>" [max_seconds]`（本番に依頼を作りポーリング）

## Phase 2 シミュレーター確認（2026-10-19）

Even Hub シミュレーター（v0.9.5、automation API）で `apps/glasses` を確認:

| 項目 | 結果 |
| --- | --- |
| 未設定画面 → スマホ側設定 → 待機画面 | OK（設定はホストストレージに保存） |
| タップで固定文送信 → 「送信済み / 回答を待っています… N秒」 → 回答表示 | OK（本番中継経由、ok-sim） |
| 長文回答のページ送り（約 400 文字 → 2 ページ、スワイプで移動、末尾で止まる） | OK |
| 回答待ち中にシミュレーターを再起動 → 待機を継続（経過秒数を引き継ぐ）→ 回答表示 | OK（再送なし） |
| CORS | 本番 `ALLOWED_ORIGINS="*"` を設定するまで `Load failed`。設定後は OK。実機の Origin は `/v1/whoami` で確認予定 |

注意: Volta の Node 22 固定はワークスペース配下で効かないため、各 `package.json` に `"volta": {"extends": "../../package.json"}` を追加。

### Phase 2 進捗（2026-10-19 時点）

- G2 アプリ（apps/glasses）: 固定文送信・状態表示・回答ページ送り・開き直し再取得・中断を実装。Codex レビュー 2 回分（競合・永続化・UX の計 15 件）を反映。単体 + 統合テスト 21 件
- シミュレーターで再検証: 待機 → タップ → 送信済み → 回答（ok-v4）。待機中の追加タップは無視される
- 実機未検証。`apps/glasses/grokeven.ehpk`（git 管理外）を Even アプリに入れて確認する手順は docs/local-dev.md
- 未決: app.json の `name`（現在 "Bot Relay"）、実機 Origin 確定後の `ALLOWED_ORIGINS` 絞り込み
