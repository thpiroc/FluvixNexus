/**
 * window ドメインの Main → Renderer イベント。
 *
 * 経緯と流れは contracts/window.ts の冒頭にある。
 */

export interface WindowCloseRequestedEvent {
  /** この確認の識別子。Renderer は `window:respond-close` にそのまま返す。 */
  readonly requestId: string
}

export interface WindowIpcEventContract {
  'window:close-requested': WindowCloseRequestedEvent
}
