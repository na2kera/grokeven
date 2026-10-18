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
