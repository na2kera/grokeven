import { whoami } from '../api/relay.ts'
import { getSettings, saveSettings, DEFAULT_BASE_URL, DEFAULT_FIXED_TEXT } from '../store/settings.ts'
import { onScreenChange, refresh } from '../glasses/app.ts'
import type { Screen } from '../glasses/state.ts'

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function describe(screen: Screen): string {
  switch (screen.kind) {
    case 'unconfigured': return '未設定: 接続先と端末トークンを保存してください'
    case 'idle': return '待機中（グラスでタップすると送信）'
    case 'sending': return '送信中…'
    case 'waiting': return `回答待ち (${screen.status}) request_id: ${screen.requestId}`
    case 'answer': return `回答あり (${screen.pages.length} ページ)`
    case 'error': return `エラー: ${screen.message.replace(/\n/g, ' ')}`
  }
}

export function mountPhoneUI(root: HTMLElement): void {
  const s = getSettings()
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      #app { max-width: 600px; margin: 0 auto; padding: 16px; display: block; }
      h1 { font-size: 20px; margin-bottom: 12px; color: #7fb8ff; }
      .card { background: #1e1e1e; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
      label { display: block; font-size: 13px; color: #aaa; margin: 10px 0 4px; }
      input, textarea { width: 100%; background: #2a2a2a; border: 1px solid #444; color: #e5e5e5;
        border-radius: 4px; padding: 8px; font-size: 14px; }
      button { cursor: pointer; border: none; border-radius: 4px; padding: 10px 14px; font-size: 14px;
        width: 100%; margin-top: 10px; }
      #btn-save { background: #7fb8ff; color: #111; font-weight: bold; }
      #btn-test { background: #2a4a6a; color: #7fb8ff; }
      .status { font-size: 13px; color: #bbb; margin-top: 8px; white-space: pre-wrap; word-break: break-all; }
      .note { font-size: 12px; color: #777; margin-top: 8px; }
    </style>
    <h1>Bot Relay 設定</h1>
    <div class="card">
      <div>グラスの状態</div>
      <div class="status" id="glasses-status">…</div>
    </div>
    <div class="card">
      <label for="base-url">中継サーバー URL</label>
      <input id="base-url" type="url" value="${escapeHtml(s.baseUrl)}" placeholder="${DEFAULT_BASE_URL}" />
      <label for="device-token">端末トークン</label>
      <input id="device-token" type="password" value="${escapeHtml(s.deviceToken)}" autocomplete="off" />
      <label for="fixed-text">タップで送る質問（Phase 2 固定文）</label>
      <textarea id="fixed-text" rows="2" placeholder="${DEFAULT_FIXED_TEXT}">${escapeHtml(s.fixedText)}</textarea>
      <button id="btn-save">保存</button>
      <button id="btn-test">接続テスト</button>
      <div class="status" id="test-status"></div>
      <div class="note">トークンはこの端末にだけ保存されます。アプリの配布物には含まれません。</div>
    </div>
  `
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!
  const statusEl = $('#glasses-status')
  const testEl = $('#test-status')

  onScreenChange(screen => {
    statusEl.textContent = describe(screen)
  })

  $('#btn-save').addEventListener('click', async () => {
    await saveSettings({
      baseUrl: $<HTMLInputElement>('#base-url').value.trim() || DEFAULT_BASE_URL,
      deviceToken: $<HTMLInputElement>('#device-token').value.trim(),
      fixedText: $<HTMLTextAreaElement>('#fixed-text').value.trim() || DEFAULT_FIXED_TEXT,
    })
    testEl.textContent = '保存しました'
    refresh()
  })

  $('#btn-test').addEventListener('click', async () => {
    testEl.textContent = '接続中…'
    try {
      const r = await whoami()
      testEl.textContent = `OK  origin=${r.origin ?? '(none)'}  cors_allowed=${r.cors_allowed}\nuser_agent=${r.user_agent ?? ''}`
    } catch (e) {
      testEl.textContent = `失敗: ${(e as Error).message}`
    }
  })
}
