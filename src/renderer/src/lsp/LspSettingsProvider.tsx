import { useCallback, useMemo, type JSX, type ReactNode } from 'react'
import {
  DEFAULT_LANGUAGE_SERVER_PREFERENCES,
  isSameLanguageServerPreferences,
  normalizeLanguageServerPreferences,
  toStoredLspSettings,
  type LanguageServerId
} from '@shared/lsp'
import { useSettingsSection } from '../settings/useSettingsSection'
import { LspSettingsContext } from './context'

/**
 * Language Server を使うかどうかを持つ器（Session 5-4）。
 *
 * ## 読み書きの段取りは既存のまま
 *
 * `useSettingsSection`（Session 4-3A）へ「どの section を、どう行き来させるか」を
 * 渡すだけで、いつ読み・いつ書くかは1行も書いていない
 * ── ThemeProvider / FilesViewProvider とまったく同じ形にあたる。
 *
 * ## 行き来の仕方だけは shared のものを使う
 *
 * 他の設定（Auto Save・Theme・Files の見え方）は、保存形式との変換を
 * Renderer 側のファイルが持っていた。**そこが Session 5-4 で1つだけ変わる。**
 *
 * `lsp` section は Main も読む（プロセスを立てる / 終わらせるのは Main）ので、
 * 読み方が2箇所にあると「Renderer では有効なのに Main では無効」が起こりうる。
 * そこで変換そのものを shared に置き、両方がそこを通る
 * （shared/lsp/serverSettings.ts。`normalizeThemeId` と同じ扱い）。
 *
 * ## この器はサーバを起こさない
 *
 * つまみを動かすと保存されるだけで、**そこから IPC でサーバを止めたり
 * 立てたりはしない。** 保存されたことに Main が気づいて動く
 * （main/lsp/languageServerSettings.ts → main/lsp/documentSync.ts）──
 * Renderer に「プロセスを操作する口」を作らない、という線を保つため。
 *
 * したがって切り替えの結果は、この値ではなく**状態の通知**として返ってくる
 * （renderer/src/lsp/useLanguageServerStatus.ts）。
 */
export function LspSettingsProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { value: preferences, update } = useSettingsSection({
    section: 'lsp',
    initial: DEFAULT_LANGUAGE_SERVER_PREFERENCES,
    fromStored: normalizeLanguageServerPreferences,
    toStored: toStoredLspSettings,
    label: 'Language Server の設定'
  })

  const setEnabled = useCallback(
    (enabled: boolean): void => {
      update((previous) => {
        const next = { ...previous, enabled }

        // 同じなら据え置く（保存と再描画が走り続ける経路を作らない）。
        return isSameLanguageServerPreferences(previous, next) ? previous : next
      })
    },
    [update]
  )

  const setServerEnabled = useCallback(
    (id: LanguageServerId, enabled: boolean): void => {
      update((previous) => {
        const next = { ...previous, servers: { ...previous.servers, [id]: enabled } }

        return isSameLanguageServerPreferences(previous, next) ? previous : next
      })
    },
    [update]
  )

  const value = useMemo(
    () => ({ preferences, setEnabled, setServerEnabled }),
    [preferences, setEnabled, setServerEnabled]
  )

  return <LspSettingsContext.Provider value={value}>{children}</LspSettingsContext.Provider>
}
