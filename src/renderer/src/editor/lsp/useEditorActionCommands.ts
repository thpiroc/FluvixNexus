import { useCommand } from '../../commands/useCommand'
import {
  EDITOR_ACTION_COMMAND_IDS,
  runEditorActionFor,
  type EditorActionTarget
} from './editorActions'

/**
 * エディタ本体を持っている間だけ、LSP の6操作を command として名乗る
 * （Session 5-12）。
 *
 * ## 名乗るのが MonacoEditor.tsx である理由
 *
 * 「所有者が自分で名乗る」（commands/useCommand.ts）に従うと、ここしかない ──
 * **叩く相手（`ICodeEditor`）を持っているのは器の側だけ**にほかならない。
 * documentStore は参照を預かってはいるが、あれは中身を差し替えるときに
 * 見ていた位置を保つためのもので、預けているのも返すのも器の側になる
 * （monaco/documentStore.ts の `attachEditor`）。
 *
 * `editor.save` / `editor.saveAs` を EditorProvider が名乗っているのと
 * 対になる ── あちらが持っているのは `EditorController`（タブと保存）で、
 * エディタ本体は持っていない。同じ `editor.` でも、持ち主が違えば
 * 名乗る場所も違う。
 *
 * ## 器が無いときは「登録しない」
 *
 * MonacoEditor が mount しているのは、**出せる中身のタブが手前にあるとき
 * だけ**になる（EditorDocumentView.tsx が `ready` 以外では Monaco を出さない）。
 * したがって、
 *
 *   - タブが1枚も無い / Editor パネルを閉じている
 *   - バイナリ・大きすぎる・読めなかったファイルを見ている
 *
 * のいずれでも、この6つは**表に載らない** ── `execute()` が false を返し、
 * KeybindingProvider は `preventDefault()` を呼ばない。何もしない handler を
 * 載せて打鍵だけ殺す形にしないのは、commands/useCommand.ts の `enabled` と
 * まったく同じ理由になる。
 *
 * ## 打鍵から見た関係
 *
 * この6つのうち5つには既定の割り当てがある（keybindings/defaults.ts）が、
 * **エディタに焦点があるとき、その打鍵は Monaco が先に処理して伝播ごと止める。**
 * つまり通常の使い方では、ここの handler は呼ばれずに同じ Action が走る ──
 * どちらの道を通っても結果が同じになるよう、handler の中身を
 * 「同じ Action を叩く」1つに揃えてある（editorActions.ts）。
 *
 * 呼ばれるのは Monaco が受け取らなかったときで、主に2つある。
 *
 *   1. 焦点が Editor パネルの中だがエディタの外（工具列のボタン・タブ）
 *   2. **その文書に Provider が無く、Monaco 側の割り当てが成立しない**
 *      （`.py` の Shift+Alt+F。Pyright は整形を出さない ── Session 5-10）
 *
 * 2 で走っても `isSupported()` が false なので何も起きない。
 * **内蔵の TypeScript 整形へ落ちることはない。**
 */
export function useEditorActionCommands(getEditor: () => EditorActionTarget | null): void {
  /*
    hook を繰り返しの中で呼んでいる。`EDITOR_ACTION_COMMAND_IDS` は
    module の定数（editorActions.ts）で長さが変わらないため、
    描画ごとの hook の並びは常に同じになる。

    6回書き並べる形にしないのは、対応表を1箇所に保つため ──
    表に1行足せば、名乗る側も同時にその command を持つ。
  */
  for (const commandId of EDITOR_ACTION_COMMAND_IDS) {
    useCommand(commandId, () => {
      runEditorActionFor(getEditor(), commandId)
    })
  }
}
