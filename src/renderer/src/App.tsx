import { useEffect, useState, type JSX } from 'react'
import type { AppInfoResponse } from '@shared/ipc'
import { fluvix } from './api/fluvix'
import { describeIpcError } from './api/result'

/**
 * Renderer は UI 描画のみを担当し、OS へは直接触れない。
 * 実行環境の情報も IPC 呼び出しも window.fluvix（Preload が公開した API）経由で行う。
 *
 * この画面は Session 1-3 の IPC 基盤が Main → Preload → Renderer まで
 * 通っていることを目視で確認するための暫定 UI であり、
 * 本来のパネル UI（Workspace / Files / Terminal / GitHub）は後続セッションで実装する。
 */

/** IPC 呼び出しの表示用の状態。成功・失敗のどちらも UI で確認できるようにする。 */
type CallState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'failure'; readonly message: string }

function App(): JSX.Element {
  const { platform, versions } = fluvix.env
  const [appInfo, setAppInfo] = useState<AppInfoResponse | null>(null)
  const [pingState, setPingState] = useState<CallState>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false

    void fluvix.system.getAppInfo().then((result) => {
      if (cancelled || !result.ok) {
        return
      }
      setAppInfo(result.data)
    })

    return () => {
      cancelled = true
    }
  }, [])

  /** token を空にすると Main 側の検証で INVALID_REQUEST になる。失敗経路の確認用。 */
  async function runPing(token: string): Promise<void> {
    setPingState({ kind: 'pending' })

    const result = await fluvix.system.ping({ token })

    if (result.ok) {
      const roundTrip = Date.now() - result.data.receivedAt
      setPingState({
        kind: 'success',
        message: `pong: ${result.data.token} (main が受信してから ${roundTrip}ms)`
      })
      return
    }

    setPingState({
      kind: 'failure',
      message: `${describeIpcError(result.error)} [${result.error.code}]`
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        // 配色・フォントは styles/global.css の土台をそのまま使う。
        height: '100%'
      }}
    >
      <h1 style={{ margin: 0 }}>Fluvix Nexus</h1>
      <p style={{ margin: 0, fontSize: 13, color: '#8a8a8a' }}>
        {platform} / Electron {versions.electron} / Chromium {versions.chrome} / Node{' '}
        {versions.node}
      </p>
      <p style={{ margin: 0, fontSize: 13, color: '#8a8a8a' }}>
        {appInfo === null
          ? 'app info を取得中…'
          : `${appInfo.name} v${appInfo.version} / ${appInfo.locale} / ${
              appInfo.isDevelopment ? 'development' : 'production'
            }`}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => void runPing(`ping-${Date.now()}`)}
          style={buttonStyle}
        >
          IPC 疎通確認
        </button>
        <button type="button" onClick={() => void runPing('')} style={buttonStyle}>
          エラー経路の確認
        </button>
      </div>

      <p
        style={{
          margin: 0,
          minHeight: 18,
          fontSize: 13,
          color: pingState.kind === 'failure' ? '#e08a8a' : '#8a8a8a'
        }}
      >
        {pingState.kind === 'idle'
          ? ''
          : pingState.kind === 'pending'
            ? '呼び出し中…'
            : pingState.message}
      </p>
    </div>
  )
}

const buttonStyle = {
  padding: '6px 14px',
  fontSize: 13,
  color: '#d4d4d4',
  background: '#2d2d2d',
  border: '1px solid #3c3c3c',
  borderRadius: 4,
  cursor: 'pointer'
} as const

export default App
