import { trimTrailingSeparator } from '../../platform/executablePath'
import {
  isSafeBatchArgument,
  isSafeBatchPath,
  type TerminalExecutableKind
} from './terminalCommand'

/**
 * 起動する形を組み立てる（Security Core v1 の STEP8。Electron にも fs にも依存しない）。
 *
 * ```
 * program   spawn(実体の絶対パス, args)                        shell を通さない
 * batch     spawn(%SystemRoot%\System32\cmd.exe,
 *                 ['/d', '/v:off', '/s', '/c', '""<実体>" arg1 arg2"'])
 * ```
 *
 * ## program はそのまま
 *
 * argv を**そのまま**渡す（`shell: false`）。パイプ・`&&`・リダイレクトは v1 では
 * 扱わない（2026-09-23 確定）── シェルの文字列にした時点で、承認した argv と
 * 実行される命令の対応が、シェルの解釈に委ねられるため。
 *
 * ## batch は cmd.exe で包む（引数は安全な文字だけ）
 *
 * .cmd / .bat は CreateProcess が直接起動できない。包む `cmd.exe` は PATH ではなく
 * `%SystemRoot%` から組み立てる（Workspace の中の `cmd.exe` を拾わない）。
 *
 *   - `/d`      AutoRun（レジストリに登録されたコマンド）を動かさない
 *   - `/v:off`  遅延展開（`!VAR!`）を切る
 *   - `/s /c`   最初と最後の `"` だけを外し、残りをそのまま1行として実行する
 *
 * 引数は `isSafeBatchArgument`（英数字と `_ - . / : = @ , + \` だけ）を通ったものに
 * 限るため、cmd.exe が区切り・展開・引用として読む文字は1つも入らない。
 * ここでも**もう一度**確かめ、外れていれば組み立てない（呼び出し側の確認に頼らない）。
 *
 * Node へは `windowsVerbatimArguments: true` で渡す ── Node 側で引用し直させると、
 * 組み立てた1行と cmd.exe が受け取る1行がずれる。
 */

export interface TerminalLaunchSpec {
  readonly file: string
  readonly args: readonly string[]
  readonly windowsVerbatimArguments: boolean
}

/** 起動する形。組み立てられなければ `null`（呼び出し側が拒否する）。 */
export function buildTerminalLaunch(
  executable: { readonly file: string; readonly kind: TerminalExecutableKind },
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): TerminalLaunchSpec | null {
  if (executable.kind === 'program') {
    return Object.freeze({
      file: executable.file,
      args: Object.freeze([...args]),
      windowsVerbatimArguments: false
    })
  }

  if (!isSafeBatchPath(executable.file) || !args.every(isSafeBatchArgument)) {
    return null
  }

  const cmd = systemCmdPath(env)

  if (cmd === null) {
    return null
  }

  const line = [`"${executable.file}"`, ...args].join(' ')

  return Object.freeze({
    file: cmd,
    args: Object.freeze(['/d', '/v:off', '/s', '/c', `"${line}"`]),
    windowsVerbatimArguments: true
  })
}

/** `%SystemRoot%\System32\cmd.exe`。読めなければ `null`（PATH には任せない）。 */
function systemCmdPath(env: Readonly<Record<string, string | undefined>>): string | null {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT

  if (typeof systemRoot !== 'string' || !/^[A-Za-z]:\\/.test(systemRoot)) {
    return null
  }

  return `${trimTrailingSeparator(systemRoot)}\\System32\\cmd.exe`
}
