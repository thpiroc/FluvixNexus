import type { TFunction } from '../i18n/messages'

/**
 * Editor Tab が取りうる状態（React にも DOM にも Monaco にも依存しない）。
 *
 * ## dirty を真偽値のまま増やさない
 *
 * Session 3-4 の時点でタブが持っていたのは `dirty: boolean` だけだった。
 * ここへ Conflict と「ディスクから消えた」を足すとき、真偽値を並べる形
 * （`dirty` / `conflict` / `deleted`）にすると、
 *
 *   - 「conflict だが dirty ではない」のような**あり得ない組み合わせ**が表現できる
 *   - 印を出す側が3つの旗の優先順位を自分で決めることになる（場所ごとにずれる）
 *
 * ため、**1つの状態にまとめてある**。Workspace Shell が
 * パネルの可視状態を真偽値で持たずレイアウトから導いている（ARCHITECTURE.md §7.7）
 * のと同じ考え方で、こちらも**元になる事実から導く**。
 *
 * ```
 * 事実（monaco/documentStore.ts が持つ）      導かれる状態
 * ─────────────────────────────────────────  ──────────
 * 版番号が保存済みと違う         … dirty
 * ディスク側が読み込み後に変わった … external
 * ディスクから消えた             … missing
 * ```
 *
 * 二重管理にならないのは、**タブは導かれた結果だけを持ち、自分では決めない**ため。
 * 決めるのは Model を持つ層（同一性の基準が違うので層が分かれている理由は
 * documentStore.ts の冒頭）で、タブはそれを表示のために写しているだけになる。
 */

/**
 * タブの状態。
 *
 * | 状態       | 意味                                                       | 閉じてよいか |
 * | ---------- | ---------------------------------------------------------- | ------------ |
 * | `clean`    | ディスクの内容と一致している                               | そのまま     |
 * | `dirty`    | 未保存の変更がある                                         | 確認する     |
 * | `conflict` | 未保存の変更があり、**ディスク側も変わっている**           | 確認する     |
 * | `deleted`  | 未保存の変更があり、**ディスクから消えている**             | 確認する     |
 */
export type EditorTabState = 'clean' | 'dirty' | 'conflict' | 'deleted'

/** タブの状態を決める元になる事実。 */
export interface EditorDocumentFacts {
  /** 保存済みの版と今の版が違うか。 */
  readonly dirty: boolean
  /** 読み込み（あるいは前回の保存）より後に、ディスク側が変わったか。 */
  readonly externalChange: boolean
  /** ディスクから消えたか。 */
  readonly missing: boolean
}

/**
 * 事実から状態を導く。
 *
 * 優先順位は「利用者が次に選べる手が何か」で決めている。
 *
 *   消えている … 保存先そのものが無い。Reload も Overwrite もできない
 *   食い違い   … Reload / Compare / Overwrite から選ぶ
 *   未保存     … 保存すれば済む
 *
 * **未保存でなければ conflict にも deleted にもしない。** 失うものが無い状態で
 * 選択肢を出しても、利用者にできることが「読み直す」しかない
 * （それは確認を出さずに済ませてよい。ARCHITECTURE.md §12.3）。
 */
export function resolveEditorTabState(facts: EditorDocumentFacts): EditorTabState {
  if (!facts.dirty) {
    return 'clean'
  }

  if (facts.missing) {
    return 'deleted'
  }

  return facts.externalChange ? 'conflict' : 'dirty'
}

/** そのタブを閉じると内容が失われるか（閉じる前の確認が要るか）。 */
export function hasUnsavedChanges(state: EditorTabState): boolean {
  return state !== 'clean'
}

/** UI に出す短い説明（文言の正本は辞書。t は呼び出し側が渡す）。 */
export function describeEditorTabState(state: EditorTabState, t: TFunction): string | null {
  switch (state) {
    case 'clean':
      return null

    case 'dirty':
      return t('editor.tabs.dirty')

    case 'conflict':
      return t('editor.tabs.conflict')

    case 'deleted':
      return t('editor.tabs.deleted')
  }
}
