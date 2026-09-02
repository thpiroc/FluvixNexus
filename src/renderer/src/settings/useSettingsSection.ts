import { useEffect, useRef, useState } from 'react'
import type { SettingsSectionId, SettingsSections, SettingsSectionUpdate } from '@shared/settings'
import { fluvix } from '../api/fluvix'

/**
 * 設定 section 1つを、ディスクと行き来しながら持つ（Session 4-3A）。
 *
 * Session 3-5 / 3-6-8 / 3-7-5 で、Editor・Files・Terminal のそれぞれが
 * **まったく同じ形**を持っていた。
 *
 *   1. 起動時に1度だけ読む
 *   2. 読み終わるまで保存を許さない（`loadedRef`）
 *   3. 値が変わったら保存する
 *   4. 読めなくても既定のまま先へ進む
 *
 * 3箇所に写しがあるということは、**間違え方も3通りある**ということで、
 * 中でも 2 は落とすと表に出にくい（起動のたびに設定が既定へ戻るが、
 * 「設定が保存されない」ようにしか見えない）。保存先が1つになったこの Session で、
 * この形もここへ集約する。
 *
 * ## 読み終わるまで書かない
 *
 * `loadedRef` が要るのは、**既定値で上書きした後に読み込みが届く**のを防ぐため。
 * state の初期値は必ず既定なので、保存を先に許すと初回の描画で既定が書かれ、
 * その後に読み込んだ値が届く ── 起動のたびに設定が消える形になる。
 *
 * ## 読めなくても先へ進む
 *
 * 読み込みに失敗しても既定のまま進む。**設定が読めないことは、エディタや端末を
 * 使えない理由にならない**（壊れた JSON 1つでシェルが1本も立たない形にしない）。
 *
 * ## ここが知らないこと
 *
 * 既定値も、値の意味も、上下限も知らない ── それは呼ぶ側（editor/autoSave.ts・
 * files/filesSettings.ts・terminal/terminalSettings.ts）が持つ。ここが持つのは
 * 「いつ読み、いつ書くか」だけで、Session 3-5 からの分担をそのまま引き継いでいる。
 */

export interface SettingsSectionBinding<Id extends SettingsSectionId, T> {
  /** どの section を読み書きするか。 */
  readonly section: Id
  /** 読み込み前・読み込めなかったときの値。 */
  readonly initial: T
  /** 保存された section から、実行時の値へ（無い key は既定へ落とすこと）。 */
  readonly fromStored: (stored: SettingsSections[Id]) => T
  /** 実行時の値から、保存する section へ。 */
  readonly toStored: (value: T) => SettingsSections[Id]
  /** 読み込みに失敗したときの言い回し（例: 'Editor の設定'）。 */
  readonly label: string
}

export interface SettingsSectionState<T> {
  readonly value: T
  /**
   * 直前の値から次の値を作る。
   *
   * 「同じなら据え置く」（前の値をそのまま返す）判断は呼ぶ側が持つ ──
   * 何をもって同じとするかは値の意味を知っている側にしか決められず、
   * ここで済ませると保存と再描画が走り続ける経路ができる。
   */
  readonly update: (change: (previous: T) => T) => void
}

export function useSettingsSection<Id extends SettingsSectionId, T>(
  binding: SettingsSectionBinding<Id, T>
): SettingsSectionState<T> {
  const [value, setValue] = useState<T>(binding.initial)

  /*
    毎回の描画で作り直される関数を effect の依存に載せないための控え。
    読み込みは1度きり・保存は値が変わったときだけ、という形を保つ。
  */
  const bindingRef = useRef(binding)
  bindingRef.current = binding

  /** 読み込みが終わったか（終わるまで書かない。このファイルの冒頭）。 */
  const loadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    void fluvix.settings.load().then((result) => {
      if (cancelled) {
        return
      }

      const { section, fromStored, label } = bindingRef.current

      if (result.ok) {
        setValue(fromStored(result.data.sections[section]))
      } else {
        console.warn(`[settings] ${label}を読み込めませんでした。`, result.error)
      }

      loadedRef.current = true
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loadedRef.current) {
      return
    }

    const { section, toStored } = bindingRef.current

    /*
      section 名で値の型が決まるユニオン（SettingsSectionUpdate）を、
      型引数のままでは組み立てられないためここだけ言い切る。
      対応そのものは SettingsSectionBinding の型が保証している。
    */
    void fluvix.settings.saveSection({ section, value: toStored(value) } as SettingsSectionUpdate)
  }, [value])

  return { value, update: setValue }
}
