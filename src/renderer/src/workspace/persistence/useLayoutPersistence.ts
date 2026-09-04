import { useEffect, useRef, useState } from 'react'
import type { WorkspaceLayoutDocument } from '@shared/workspace'
import { fluvix } from '../../api/fluvix'
import type { LayoutPresetId } from '../layout/presets'
import type { WorkspaceLayout } from '../layout/types'
import { serializeWorkspaceLayout } from './layoutDocument'
import { restoreWorkspaceLayout } from './restoreLayout'

/**
 * レイアウトの保存 / 復元を Main 側の store へつなぐ層。
 *
 * 経路は STEP 1 の責務分離のまま。Renderer はファイルシステムに触れない。
 *
 *   Renderer（この hook）
 *      ↓  window.fluvix.workspace
 *   Preload（preload/api/workspace.ts）
 *      ↓  IPC（workspace:load-layout / workspace:save-layout）
 *   Main（ipc/handlers/workspace.ts → store/workspaceLayout.ts）
 *      ↓
 *   %APPDATA%/Fluvix Nexus/workspace-layout.json
 *
 * この hook が持つのは「いつ読むか / いつ書くか」だけで、
 * 何を書くか（保存形式）と読んだものが正しいかの判断は persistence/layoutDocument.ts が持つ。
 *
 * 守っていること:
 *
 * - **復元が終わるまで画面を描かない。** 先に Default を描いてから差し替えると
 *   起動のたびに配置が飛ぶうえ、その間の操作が復元で上書きされる。
 * - **保存は変更のたびに予約し、間引く。** ドラッグやリサイズは毎フレーム
 *   レイアウトを変えるため、そのまま送ると IPC と書き込みが数百回になる。
 * - **同じ内容を書き直さない。** 直前に保存を依頼した内容と一致する変更は捨てる。
 * - **失敗しても操作は続く。** 保存できなくても画面は動き続け、次回起動が
 *   前回保存できた状態に戻るだけで済む（理由は console に残す）。
 */

/**
 * レイアウトが変わってから保存を依頼するまでの待ち時間。
 *
 * Main 側の store も同じだけ間引くため、実際の書き込みは操作が止まってから
 * 最大 800ms 後になる。ドラッグ中に1回も書かないことの方が重要なので、
 * この長さは短くしない。
 */
const SAVE_DELAY_MS = 400

export interface LayoutPersistenceOptions {
  readonly layout: WorkspaceLayout
  readonly presetId: LayoutPresetId
  /**
   * 保存済みレイアウトを読み込めたときに1度だけ呼ばれる。
   *
   * 呼ばれなかった場合（未保存・破損・非対応バージョン）は Default Layout のまま進む。
   * 参照が変わると読み込みを繰り返してしまうため、安定した関数を渡すこと。
   */
  readonly onRestore: (layout: WorkspaceLayout, presetId: LayoutPresetId) => void
}

export interface LayoutPersistenceState {
  /** 復元の試行が終わったか。false の間は画面を描かない。 */
  readonly restored: boolean
}

export function useLayoutPersistence({
  layout,
  presetId,
  onRestore
}: LayoutPersistenceOptions): LayoutPersistenceState {
  const [restored, setRestored] = useState(false)

  /** 直前に保存を依頼した内容（JSON）。同じ内容の書き込みを繰り返さないための控え。 */
  const savedJsonRef = useRef<string | null>(null)
  /** 間引き待ちの内容。終了時に取りこぼさないよう、タイマーとは別に持つ。 */
  const pendingRef = useRef<WorkspaceLayoutDocument | null>(null)
  const timerRef = useRef<number | null>(null)

  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore

  // 起動時の復元。
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const result = await fluvix.workspace.loadLayout()

      if (cancelled) {
        return
      }

      if (!result.ok) {
        console.warn('[workspace] 保存されたレイアウトを読み込めませんでした。', result.error)
      } else if (result.data.document !== null) {
        applyRestored(result.data.document)
      }

      // 読めても読めなくても、ここから先は通常の保存対象になる。
      // 読めなかった場合（初回起動 / 壊れていた場合）は、下の効果がそのまま
      // Default Layout を書き込む。保存ファイルが常に「今の画面」を表す状態になり、
      // 壊れたファイルもその時点で正常な内容に置き換わる。
      setRestored(true)
    })()

    function applyRestored(document: WorkspaceLayoutDocument): void {
      const restoredLayout = restoreWorkspaceLayout(document)

      if (!restoredLayout.ok) {
        // 壊れている / 非対応バージョン / 知らない PanelId など。
        // 落とさず Default Layout で起動し、理由だけ残す（次の変更で上書きされる）。
        console.warn(
          `[workspace] 保存されたレイアウトを復元できないため初期配置で起動します: ${restoredLayout.reason}`
        )
        return
      }

      // 復元した内容は、次の変更まで書き直す必要が無い。
      savedJsonRef.current = JSON.stringify(
        serializeWorkspaceLayout(restoredLayout.layout, restoredLayout.presetId)
      )

      onRestoreRef.current(restoredLayout.layout, restoredLayout.presetId)
    }

    return () => {
      cancelled = true
    }
  }, [])

  // 変更のたびに保存を予約する。
  useEffect(() => {
    if (!restored) {
      // 復元前の state は「まだ読み込んでいない Default」であり、保存すると
      // 前回の配置を上書きしてしまう。
      return
    }

    const document = serializeWorkspaceLayout(layout, presetId)
    const json = JSON.stringify(document)

    if (json === savedJsonRef.current) {
      return
    }

    savedJsonRef.current = json
    pendingRef.current = document

    // 直前の予約は捨てて取り直す（＝操作が続いている間は書かない）。
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      flushPendingSave()
    }, SAVE_DELAY_MS)

    function flushPendingSave(): void {
      const pending = pendingRef.current

      if (pending === null) {
        return
      }

      pendingRef.current = null

      void fluvix.workspace.saveLayout({ document: pending }).then((result) => {
        if (!result.ok) {
          /*
            開発者向けの記録。利用者向けの文言（describeIpcError）はここでは使わない
            ── コンソールに要るのは翻訳された文ではなく**コードと詳細**で、
            他の開発者向けログ（`[terminal] …`）と同じ扱いにしてある。
          */
          console.warn('[workspace] レイアウトを保存できませんでした', result.error)
          // 控えを捨てて、次の変更で改めて保存を試みられるようにする。
          savedJsonRef.current = null
        }
      })
    }
  }, [restored, layout, presetId])

  // 間引き待ちのまま画面が閉じられるのを防ぐ。
  // 送るところまでが Renderer の役目で、実際の書き込みは Main 側が will-quit で仕上げる。
  useEffect(() => {
    function sendPendingNow(): void {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }

      const pending = pendingRef.current

      if (pending === null) {
        return
      }

      pendingRef.current = null
      void fluvix.workspace.saveLayout({ document: pending })
    }

    window.addEventListener('pagehide', sendPendingNow)

    return () => {
      window.removeEventListener('pagehide', sendPendingNow)
      sendPendingNow()
    }
  }, [])

  return { restored }
}
