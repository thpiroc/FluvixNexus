import { useCallback, useMemo, useRef } from 'react'
import type { SettingsScope, SettingsSectionId, SettingsSections } from '@shared/settings'
import { useSettingsScope } from './scopeContext'
import type { SettingsSectionBinding, SettingsValueUpdate } from './settingsBinding'
import type { SettingsWriteTarget } from './settingsScopeState'

export type { SettingsSectionBinding, SettingsValueUpdate } from './settingsBinding'

/**
 * 設定 section 1つを、実行時の値として読み書きする（Session 4-3A。feature/settings-scope で改修）。
 *
 * ## 各機能は scope を意識しない
 *
 * `useSettingsSection` が返すのは**実際に効く値**（key 単位で
 * `ワークスペース設定 > ユーザー設定 > 既定`）で、呼ぶ側の Editor / Files / Terminal /
 * Theme / Language / LSP は、その値がどちらの scope から来たかを知らない。
 * 既定への落とし込み・上下限は今までどおり `fromStored` が持つ。
 *
 * 書くときは、変わった key を**その key を今決めている scope**へ書く
 * （settings/settingsScopeState.ts の `auto`）。
 *
 * ## Settings 画面だけは scope を選ぶ
 *
 * `useScopedSettingsSection` は、選んでいる scope から見た値を読み、その scope へ書く。
 * 同じ binding を使うので、値の意味（既定・上下限・同じなら据え置く）は1つのまま。
 *
 * ## 読み終わるまで書かない
 *
 * Session 4-3A からの約束。読み込み前は `initial` を返し、その間の書き込みは捨てる
 * （既定で上書きした後に読み込みが届くと、起動のたびに設定が消える形になる）。
 * 読み込みそのものは settings/SettingsScopeProvider.tsx が1度だけ行う。
 *
 * ## ここが知らないこと
 *
 * 既定値も、値の意味も、上下限も知らない ── それは呼ぶ側（editor/autoSave.ts・
 * files/filesSettings.ts・terminal/terminalSettings.ts）が持つ。
 */

export interface SettingsSectionState<T> {
  readonly value: T
  /** 直前の値から次の値を作る（同じなら前の値を返すこと）。 */
  readonly update: SettingsValueUpdate<T>
}

/** 各機能が使う。実際に効く値を読み、その key を今決めている scope へ書く。 */
export function useSettingsSection<Id extends SettingsSectionId, T>(
  binding: SettingsSectionBinding<Id, T>
): SettingsSectionState<T> {
  const { effective } = useSettingsScope()

  return useBoundSection(binding, effective, 'auto')
}

/**
 * Settings 画面が使う。選んでいる scope から見た値を読み、その scope へ書く。
 *
 *   `user`      … ユーザー設定の値（このプロジェクトで上書きしていても、ユーザー設定の値）
 *   `workspace` … このプロジェクトで実際に効く値（上書きが無ければユーザー設定の値）
 */
export function useScopedSettingsSection<Id extends SettingsSectionId, T>(
  binding: SettingsSectionBinding<Id, T>,
  scope: SettingsScope
): SettingsSectionState<T> {
  const { ready, user, effective } = useSettingsScope()
  const sections = !ready ? null : scope === 'user' ? user : effective

  return useBoundSection(binding, sections, scope)
}

function useBoundSection<Id extends SettingsSectionId, T>(
  binding: SettingsSectionBinding<Id, T>,
  sections: SettingsSections | null,
  target: SettingsWriteTarget
): SettingsSectionState<T> {
  const { writeSection } = useSettingsScope()

  /*
    毎回の描画で作り直される binding を依存に載せないための控え。
    値は section の object が変わったときだけ作り直す（中身の変わらない section は
    同じ object のまま届く。SettingsScopeProvider.tsx）。
  */
  const bindingRef = useRef(binding)
  bindingRef.current = binding

  const stored = sections === null ? null : sections[binding.section]

  const value = useMemo(
    () => (stored === null ? bindingRef.current.initial : bindingRef.current.fromStored(stored)),
    [stored]
  )

  const valueRef = useRef(value)
  valueRef.current = value

  const readyRef = useRef(sections !== null)
  readyRef.current = sections !== null

  const targetRef = useRef(target)
  targetRef.current = target

  const update = useCallback<SettingsValueUpdate<T>>(
    (change) => {
      const previous = valueRef.current
      const next = change(previous)

      // 同じなら据え置く（呼ぶ側が前の値を返した）。読み込み前は書かない（このファイルの冒頭）。
      if (Object.is(next, previous) || !readyRef.current) {
        return
      }

      const { section, toStored } = bindingRef.current

      // 同じ描画の間に続けて届く更新（打鍵の連打など）が、この値から続きを作れるように。
      valueRef.current = next
      writeSection(section, toStored(previous), toStored(next), targetRef.current)
    },
    [writeSection]
  )

  return { value, update }
}
