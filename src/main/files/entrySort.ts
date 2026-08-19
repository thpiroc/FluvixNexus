import type { FileEntry } from '@shared/files'

/**
 * ツリーに並べる順序。
 *
 * 初期仕様は「フォルダが先、それぞれ名前順」の1つだけ（DESIGN.md §3 / Session 3-2）。
 * それでも並べ替えを1つの関数として切り出してあるのは、
 *   - 種類（更新日時順・拡張子順）を足すとき、増えるのがこのファイルだけになる
 *   - 「どういう順か」をテストで固定できる
 * ため。
 *
 * **並べ替えを Main 側で済ませている**のは、Renderer が受け取った時点で
 * 表示順になっている方が、ツリーの描画が「配列の順に並べるだけ」で済むから。
 * 利用者が順序を選べるようにする段階では、契約
 * （shared/ipc/contracts/files.ts）に順序の指定を足してここへ渡す形にする。
 * Renderer 側で並べ替えると、フォルダの中身の正本を Renderer が持つ話に近づく。
 */

/**
 * 名前の比較。
 *
 * 大文字小文字を区別しないのは、ファイル名の大小は利用者にとって
 * 並び順の意味を持たないため（`README.md` が `src` より前に来る／後に来るが
 * 表記だけで入れ替わると探しにくい）。
 * 数値を数として見る（numeric）ので、`item2` は `item10` より前に来る。
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * 並び順の判定。
 *
 * 1. フォルダが先、ファイルが後
 * 2. 名前順（大文字小文字を区別しない・数値は数として見る）
 * 3. それでも同じなら素の文字列で比較する
 *
 * 3 を足してあるのは、`README.md` と `readme.md` のように collator では
 * 同じと見なされる組が実際に共存しうるため（Windows では作れないが、
 * 大文字小文字を区別するファイルシステムでは起きる）。
 * ここを 0 のままにすると、読み込むたびに並びが入れ替わって見える。
 */
export function compareFileEntries(a: FileEntry, b: FileEntry): number {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1
  }

  const byName = collator.compare(a.name, b.name)

  if (byName !== 0) {
    return byName
  }

  if (a.name === b.name) {
    return 0
  }

  return a.name < b.name ? -1 : 1
}

/** 表示順に並べ替えた新しい配列を返す（入力は書き換えない）。 */
export function sortFileEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort(compareFileEntries)
}
