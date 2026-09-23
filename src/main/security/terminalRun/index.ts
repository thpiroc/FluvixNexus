/**
 * Terminal Command Runner の API（Security Core v1 の STEP8）。
 *
 * ```
 * runAgentTerminalCommand({ command, args, cwd })   承認を通してから、コマンドを1つ実行する
 * ```
 *
 * ## 決めてあること（2026-09-23 確定）
 *
 * ```
 * 形         argv のまま（shell を通さない）。パイプ・&&・リダイレクトは v1 では扱わない
 * command    PATH 上の名前だけ。PATH は Main が辿る（Workspace の中は使わない）
 * .cmd/.bat  cmd.exe で包む。引数は安全な文字だけ（外れたら拒む）
 * 承認       毎回。内容は省略せずに見せる（コマンド全体 2,000 文字まで）
 * 時間       120 秒固定。中断ボタンは v1 では作らない
 * 出力       先頭から 1,000,000 文字まで集め、伏せてから渡す。画面へは伏せた後の末尾
 * Audit      requested / approved / denied / completed / failed（引数・出力は載せない）
 * ```
 *
 * ## ここに無いもの
 *
 * **承認を飛ばす・shell を通す・実行ファイルを指定する API は無い。**
 * `runUnsafe` / `skipApproval` / `bypassGate` / `shell` / `trustRenderer` にあたる
 * 引数も関数も無い（terminalRunSurface.test.ts が公開する名前を固定している）。
 */
export { runAgentTerminalCommand } from './currentTerminalRunGate'

export type { TerminalRunOutcome, TerminalProposalNotice } from './terminalRunGate'
export type { SafeTerminalOutput } from './terminalOutput'
