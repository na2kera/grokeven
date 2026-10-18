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
