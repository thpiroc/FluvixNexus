/**
 * File Write Gate の API（Security Core v1 の STEP7）。
 *
 * FN Agent が Workspace の中のファイルを書き換えるときに**必ず通る、唯一の経路**。
 *
 * ```
 * writeAgentWorkspaceFile(relativePath, content)   承認を通してから1回だけ書く
 * ```
 *
 * ## 決めてあること
 *
 * ```
 * 所有       Main の Security Core だけ。Renderer / Agent から filesystem へは届かない
 * 受け取る   Workspace 相対の綴りと本文の2つだけ（絶対パス・ハンドル・申告は受け取らない）
 * 順番       Boundary → Secret → Policy → 本文 → Diff → 承認 → consume → recheck →
 *            open → confirm → 書く → 書いた結果の確認 → Audit
 * Diff       Main が作り、STEP3 で Mask して切ってから Renderer へ送る
 * 書き方     既存は 'r+'（切り詰めずに開く）・新規は 'wx'（排他作成）。ハンドル越しにだけ書く
 * 1件ずつ     同時に2件は承認にかけない（write-in-progress）
 * Fail closed 判定・承認・確認のどれか1つでも通らなければ書かない
 * ```
 *
 * ## ここに無いもの
 *
 * **承認を飛ばす・確認を省く・raw な fs へ落ちる経路は無い。**
 * `forceWrite` / `writeUnsafe` / `skipApproval` / `bypassGate` / `trustRenderer` に
 * あたる引数も関数も無く、Renderer が本文や Diff を書き戻せる口も無い
 * （fileWriteSurface.test.ts が公開する名前を一覧で固定している）。
 *
 * ## ここが持たないもの
 *
 * 利用者が Editor で保存する経路（`files:write-file` → main/files/writeWorkspaceFile.ts）は
 * **別のまま。** あちらは承認も Diff も要らない人の操作で、こちらは Agent の提案にあたる。
 * Terminal の実行（STEP8）・MCP の書き込み・Git の Commit / Push・binary の書き込みは
 * この Gate の対象ではない。
 */
export { writeAgentWorkspaceFile } from './currentFileWriteGate'

export type { FileWriteOutcome, FileWriteProposalNotice } from './fileWriteGate'
