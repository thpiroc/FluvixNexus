import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { SaveSettingsSectionRequest } from '@shared/ipc'
import {
  resolveEffectiveSettings,
  type SettingsSectionId,
  type SettingsSections
} from '@shared/settings'
import { fluvix } from '../api/fluvix'
import { SettingsScopeContext, type SettingsScopeController } from './scopeContext'
import {
  fallbackSettingsScopeState,
  planSettingsWrite,
  planWorkspaceReset,
  type PlannedSettingsWrite,
  type ReadySettingsScopeState,
  type SettingsScopeState,
  type SettingsWriteTarget
} from './settingsScopeState'

/**
 * ユーザー設定 / ワークスペース設定を、ディスクと行き来しながら1箇所で持つ（feature/settings-scope）。
 *
 * Session 4-3A の `useSettingsSection` は、機能ごとに「起動時に1度だけ読み、
 * 読み終わるまで書かず、変わったら書く」を持っていた。scope が2つになると
 * 「どの scope の値が効いているか」を全機能が同じ答えで持つ必要があり、
 * 機能ごとに読み込むと Workspace を切り替えた瞬間に答えが割れる。そこで
 * 読み込みと写しをここへ集め、各機能は**ここから組み立てた効く値**を読む形にした。
 *
 * ## 置き場所はアプリの一番外側
 *
 * Theme と Language も設定を読むので、それより外に置く（App.tsx）。
 * そのため Workspace を開く UI（WorkspaceFolderProvider）より外になり、
 * **Workspace が切り替わったことは Main から受け取る**
 * （`settings:workspace-changed`）── Main の正本が切り替わった時点で読み直すので、
 * 保存先（Main）と写し（ここ）が別の Workspace を見ている時間ができない。
 *
 * ## 読み終わるまで書かない
 *
 * Session 4-3A からの約束をそのまま引き継ぐ。読み込み前の値は各機能の既定で、
 * それを書くと保存されていた値が消える。読めなかった場合は空の設定で始め、
 * 以降の書き込みは通す（設定が読めないことはアプリを使えない理由にならない）。
 */
export function SettingsScopeProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [state, setState] = useState<SettingsScopeState>({ status: 'loading' })

  /*
    書き込みはイベント（クリック・打鍵）の時間軸で届き、同じ描画の間に続けて届くことも
    ある。組み立ては state ではなくこの控えから行い、控えは組み立てた瞬間に進める
    ── 2つ目の書き込みが1つ目を巻き戻さないように。
  */
  const stateRef = useRef<SettingsScopeState>(state)

  /** 読み込みの世代。古い読み込みの結果が、後から届いた新しい結果を上書きしないように。 */
  const loadGenerationRef = useRef(0)

  const replaceState = useCallback((next: SettingsScopeState): void => {
    stateRef.current = next
    setState(next)
  }, [])

  const load = useCallback((): void => {
    const generation = ++loadGenerationRef.current

    void fluvix.settings.load().then((result) => {
      if (generation !== loadGenerationRef.current) {
        return
      }

      if (result.ok) {
        replaceState({ status: 'ready', user: result.data.user, workspace: result.data.workspace })
      } else {
        console.warn('[settings] 設定を読み込めませんでした。既定で始めます。', result.error)
        replaceState(fallbackSettingsScopeState())
      }
    })
  }, [replaceState])

  useEffect(() => {
    load()

    // Workspace が切り替わると、効くワークスペース設定も切り替わる。
    const unsubscribe = fluvix.settings.onWorkspaceChanged(() => {
      load()
    })

    return () => {
      loadGenerationRef.current += 1
      unsubscribe()
    }
  }, [load])

  const commit = useCallback(
    (plan: (ready: ReadySettingsScopeState) => PlannedSettingsWrite): void => {
      const current = stateRef.current

      if (current.status !== 'ready') {
        return
      }

      const { next, requests } = plan(current)

      if (requests.length === 0) {
        return
      }

      replaceState(next)

      for (const request of requests) {
        send(request)
      }
    },
    [replaceState]
  )

  const writeSection = useCallback(
    (section: SettingsSectionId, before: object, after: object, target: SettingsWriteTarget) => {
      commit((ready) => planSettingsWrite(ready, section, before, after, target))
    },
    [commit]
  )

  const resetWorkspaceKeys = useCallback(
    (section: SettingsSectionId, keys: readonly string[]) => {
      commit((ready) => planWorkspaceReset(ready, section, keys))
    },
    [commit]
  )

  /*
    効く値は描画のたびに組み立て直すが、**中身の変わらない section は前と同じ object を
    返す**（resolveEffectiveSettings の `previous`）。各機能はこの section を描画の依存に
    載せるので、Terminal の文字を変えただけで Editor の設定まで作り直さない。
  */
  const previousEffectiveRef = useRef<SettingsSections | undefined>(undefined)

  const effective = useMemo(() => {
    if (state.status !== 'ready') {
      return null
    }

    const resolved = resolveEffectiveSettings(
      state.user,
      state.workspace?.sections ?? null,
      previousEffectiveRef.current
    )

    previousEffectiveRef.current = resolved
    return resolved
  }, [state])

  const value = useMemo<SettingsScopeController>(
    () =>
      state.status === 'ready'
        ? {
            ready: true,
            user: state.user,
            workspace: state.workspace,
            effective,
            writeSection,
            resetWorkspaceKeys
          }
        : {
            ready: false,
            user: EMPTY_SECTIONS,
            workspace: null,
            effective: null,
            writeSection,
            resetWorkspaceKeys
          },
    [state, effective, writeSection, resetWorkspaceKeys]
  )

  return <SettingsScopeContext.Provider value={value}>{children}</SettingsScopeContext.Provider>
}

const EMPTY_SECTIONS: SettingsSections = fallbackSettingsScopeState().user

/**
 * Main へ送る。失敗しても写しは戻さない ── 画面は選んだ値のまま動き、
 * 次回の起動で保存されていた値へ戻るだけで済む（Session 4-3A からの扱い）。
 */
function send(request: SaveSettingsSectionRequest): void {
  void fluvix.settings.saveSection(request).then((result) => {
    if (!result.ok) {
      console.warn(
        `[settings] ${request.scope} の ${request.section} を保存できませんでした。`,
        result.error
      )
    }
  })
}
