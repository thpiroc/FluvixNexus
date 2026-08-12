import type { DockNodeId } from './types'

/**
 * ノード id の発番。
 *
 * layout/ の中で唯一、状態を持つ（＝純粋でない）モジュール。
 * ここに閉じ込めてあるのは、operations.ts をテストしやすい純粋関数のままにするため。
 * 操作関数は id 生成器を引数で受け取れるようにしてあり、テストでは決まった id を注入する。
 */

const GENERATED_ID_PREFIX = 'dock-'

let counter = 0

/**
 * 文字列を DockNodeId として扱う。
 *
 * 使ってよいのは「id を自分で決める場所」＝初期レイアウトの定義と、
 * 保存されたレイアウトの読み込みだけ。通常の生成は createDockNodeId を使う。
 */
export function asDockNodeId(value: string): DockNodeId {
  return value as DockNodeId
}

/** 新しいノード id を発番する。 */
export function createDockNodeId(): DockNodeId {
  counter += 1

  return asDockNodeId(`${GENERATED_ID_PREFIX}${counter}`)
}

/**
 * 既存の id と衝突しない位置までカウンタを進める。
 *
 * 保存したレイアウトを読み込む際に呼ぶ（Session 2-3 以降）。
 * これを忘れると、復元したレイアウトに含まれる `dock-3` と、
 * 起動後に発番した `dock-3` が衝突する。
 */
export function reserveDockNodeIds(ids: Iterable<DockNodeId>): void {
  for (const id of ids) {
    if (!id.startsWith(GENERATED_ID_PREFIX)) {
      continue
    }

    const used = Number.parseInt(id.slice(GENERATED_ID_PREFIX.length), 10)

    if (Number.isInteger(used) && used > counter) {
      counter = used
    }
  }
}
