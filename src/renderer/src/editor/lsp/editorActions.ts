/**
 * Command から Monaco の Action を呼ぶ（Session 5-12）。
 *
 * ## 何を足していないか
 *
 * **LSP を呼ぶ経路を1つも足していない。** Session 5-5 〜 5-11 で
 * `monaco.languages.register*Provider` に載せた6つの Provider は、
 * Monaco の Action（`editor.action.revealDefinition` ほか）から既に呼ばれている。
 * ここがするのは、その Action を**打鍵以外の入口からも叩けるようにする**ことだけで、
 * 要求の組み立ても IPC も Renderer 側の再実装も1つも増えない。
 *
 * ```
 * 打鍵 → KeybindingProvider → command → ここ → Monaco Action → 登録済み Provider → IPC
 *                                              ↑ 5-12 で足したのはこの1本の矢印だけ
 * ```
 *
 * したがって Main 側は**1行も変わらない**。汎用の LSP IPC も、
 * Renderer から渡す method 名も、サーバの選択も増えない
 * （ARCHITECTURE.md §9.2 の境界はそのまま）。
 *
 * ## Monaco の Action は2通りに登録されている
 *
 * ここが実装の要点にあたる。**同じ「Action」に見えて、登録の仕組みが2つある。**
 *
 * | 登録の仕組み          | 例                                    | `editor.getAction()` |
 * | --------------------- | ------------------------------------- | -------------------- |
 * | `registerEditorAction`| rename / formatDocument / triggerSuggest / showHover | **出る**   |
 * | `registerAction2`     | **revealDefinition / goToReferences** | **出ない（null）**   |
 *
 * `ICodeEditor.getAction()` が引くのは前者の表だけで
 * （`codeEditorWidget.js` の `this._actions`）、定義 / 参照は後者にあたる
 * （`contrib/gotoSymbol/browser/goToCommands.js` は `registerAction2`）。
 * **`getAction()` だけで済ませると、6つのうち2つが黙って何もしない。**
 * Session 5-12 の production 確認で実際にそうなった ── Rename / 整形 / 補完は
 * 動くのに、F12 と Shift+F12 だけが無反応だった。
 *
 * したがって実行は `editor.trigger()` に一本化する。あちらは
 *
 *   1. `getAction()` に出るなら、その Action を走らせる（`isSupported()` を内側で見る）
 *   2. 出ないなら `commandService.executeCommand()` へ落とす
 *
 * という順で、**両方の仕組みを1つの呼び方で受ける**。
 *
 * ## capability はどちらの道でも効く
 *
 * 「その文書で今できるか」は、どちらの道でも Monaco の側が見る。
 *
 * | 道                | 誰が precondition を見るか                              |
 * | ----------------- | ------------------------------------------------------- |
 * | `registerEditorAction` | `InternalEditorAction.run()`（`isSupported()`）     |
 * | `registerAction2` | `EditorAction2.run()`（`contextMatchesRules`）           |
 *
 * precondition は登録済みの Provider から立つ context key
 * （`hasDefinitionProvider` / `hasDocumentFormattingProvider` …）なので、
 * **Session 5-10 / 5-11 の判断がそのまま効く** ── Pyright は整形を出さず、
 * python には整形 Provider を登録していない（lsp/formattingAvailability.ts）ので、
 * `.py` では `hasDocumentFormattingProvider` が立たず何も起きない。
 *
 * **`.py` を TypeScript worker へ渡す道が、この経路には存在しない** ──
 * 渡すかどうかを決めているのは Provider の中（monaco/lspFormatting.ts）で、
 * ここは Action を叩くだけであり、言語で分岐する if を1つも持たない。
 * C# で Shift+Alt+F が効くのも同じ理由で、csharp-ls が整形を出すために
 * csharp が `LSP_FORMATTING_LANGUAGE_IDS` に載っている、それだけになる。
 *
 * ## Monaco を import しない
 *
 * 受け取る型は構造的部分型にしてある（`EditorActionTarget`）。
 * `monaco-editor` を値として import してよいのは monacoSetup.ts /
 * MonacoEditor.tsx / MonacoDiffEditor.tsx / markers.ts だけ、という
 * 既存の決め（monaco/monacoSetup.ts の冒頭）を崩さないためで、
 * 副産物としてこのファイルは素のテストから試せる。
 */

import type { CommandId } from '../../commands/commandIds'

/**
 * Action を叩くのに要るぶんだけの Monaco エディタ。
 *
 * `monaco.editor.ICodeEditor` はこの形を満たす（`getAction` も `trigger` も
 * `ICodeEditor` が持つ）。
 */
export interface EditorActionTarget {
  focus: () => void
  getAction: (id: string) => EditorAction | null
  trigger: (source: string | null | undefined, handlerId: string, payload: unknown) => void
}

/** `monaco.editor.IEditorAction` のうち、ここが触るもの。 */
export interface EditorAction {
  isSupported: () => boolean
}

/**
 * `trigger()` に添える呼び出し元の名前。
 *
 * Monaco はこれを `onWillTriggerEditorOperation` などへそのまま流す。
 * `'keyboard'` を名乗らないのは、あれが**実際の打鍵**を意味する予約された名前で、
 * 入力として扱われる分岐がいくつかあるため（`_type` ほか）。
 */
export const EDITOR_ACTION_SOURCE = 'fluvix.command'

/** Monaco の Action へ繋いである command。 */
export type EditorActionCommandId = Extract<
  CommandId,
  | 'editor.goToDefinition'
  | 'editor.findReferences'
  | 'editor.renameSymbol'
  | 'editor.formatDocument'
  | 'editor.triggerSuggest'
  | 'editor.showHover'
>

/**
 * command と Monaco の Action の対応。
 *
 * **1対1で、ここ以外に書かない。** 同じ対応を打鍵の側にも持たせると、
 * 「Command Palette から呼んだときと打鍵で呼んだときで違う Action が走る」が
 * 作れてしまう（打鍵の側が知っているのは command の名前だけ ──
 * keybindings/defaults.ts）。
 */
export const EDITOR_ACTION_BY_COMMAND: Readonly<Record<EditorActionCommandId, string>> = {
  'editor.goToDefinition': 'editor.action.revealDefinition',
  'editor.findReferences': 'editor.action.goToReferences',
  'editor.renameSymbol': 'editor.action.rename',
  'editor.formatDocument': 'editor.action.formatDocument',
  'editor.triggerSuggest': 'editor.action.triggerSuggest',
  'editor.showHover': 'editor.action.showHover'
}

/** Monaco の Action へ繋いである command の一覧（上の表の見出しそのもの）。 */
export const EDITOR_ACTION_COMMAND_IDS = Object.keys(
  EDITOR_ACTION_BY_COMMAND
) as readonly EditorActionCommandId[]

/**
 * その command の Action を叩く。**叩けたときだけ true。**
 *
 * 返り値が false になるのは2通りで、どちらも失敗ではない。
 *
 *   - エディタが無い（Editor パネルを閉じている・タブが1枚も無い・
 *     出せない中身を開いている）
 *   - **その文書では今できないと Monaco が言った**（`isSupported()` が false）
 *
 * 2つめが Session 5-10 / 5-11 の判断の現れにあたる ── Pyright は整形を
 * 出さないので `.py` では `hasDocumentFormattingProvider` が立たず、
 * ここは何もしない。**何もしないことが正しい答え**で、代わりに内蔵の
 * TypeScript worker へ渡す道はこの関数にも Provider にも無い。
 *
 * ## 事前に訊けるのは半分だけ
 *
 * `getAction()` に出ない2つ（定義 / 参照）については、ここで `isSupported()` を
 * 訊けない（このファイルの冒頭）。それらは `trigger()` の先で
 * `EditorAction2.run()` が同じ precondition を見て、通らなければ何もしない
 * ── **判断はどちらの道でも Monaco の側にあり、その写しをここに持たない。**
 * 違いは「できなかったことをここが知れるか」だけで、結果は変わらない。
 *
 * ## 先に focus を当てる
 *
 * 2つの理由があり、どちらも欠かせない。
 *
 *   1. Rename の入力欄も補完の一覧も、エディタの中に出る部品にあたる。
 *      工具列のボタンに焦点があるまま叩くと、出た部品へ打てない
 *   2. **`registerAction2` の Action は、焦点のあるエディタを自分で探す**
 *      （`EditorAction2.run` の `getFocusedCodeEditor() ?? getActiveCodeEditor()`）
 *      ── 焦点を戻さずに叩くと、定義 / 参照は相手を見つけられない
 *
 * 焦点が既にエディタにあるときは何も起きない（Monaco の `focus()` は冪等）。
 */
export function runEditorActionFor(
  editor: EditorActionTarget | null,
  commandId: EditorActionCommandId
): boolean {
  if (editor === null) {
    return false
  }

  const actionId = EDITOR_ACTION_BY_COMMAND[commandId]
  const action = editor.getAction(actionId)

  /*
    出来ないと分かっているなら、焦点も動かさない。
    `null`（＝ `registerAction2` の側）は「分からない」であって「出来ない」ではない。
  */
  if (action !== null && !action.isSupported()) {
    return false
  }

  editor.focus()
  editor.trigger(EDITOR_ACTION_SOURCE, actionId, undefined)

  return true
}
