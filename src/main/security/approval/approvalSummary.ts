import { maskSecretLines } from '../fileWrite/secretLineMask'
import { redactSecretText, SECRET_MASK } from '../secret/secretMasking'
import { APPROVAL_CWD_MAX_LENGTH, type NormalizedApprovalAction } from './approvalAction'

/**
 * 承認の画面と記録に出してよい要約（Security Core v1 の STEP6。Electron に依存しない）。
 *
 * Renderer の確認・Main の Native 確認・Audit Log の3か所は、**この要約しか見ない。**
 * 本文も raw なコマンドも渡らない。
 *
 * ```
 * 出す     操作の種類・Workspace 相対の対象・Mask 済みのコマンドの1行
 * 出さない 書き込む本文・Diff 本文・コマンドの出力・絶対パス・Secret
 * ```
 *
 * ## 表示用と binding 用を分ける
 *
 * ここが作るのは**表示のための文字列**で、承認と実行を結び付けるのは
 * fingerprint（approvalFingerprint.ts）の方。分けてあるのが要点で、
 *
 *   - 表示は Mask を通る（Secret を画面にも Log にも出さない）
 *   - binding は Mask を通らない（実行する exact な command / args と突き合わせる）
 *
 * を同時に満たす。**Mask 済みの文字列を突き合わせに使わない** ── 伏せた後の
 * `***REDACTED***` は元の値を1つに定めないため、違うコマンドが同じ表示になりうる。
 *
 * ## コマンドは必ず Mask を通す
 *
 * `npm publish --token ghp_…` のように、コマンドそのものに Secret が混ざることがある
 * （DESIGN.md §6.4）。Renderer へ送る前・Native 確認に出す前・Audit へ渡す前の
 * すべてで、STEP3 の `redactSecretText()` を通した後の文字列だけを使う。
 *
 * ## 長さで切る（File Write の Path と、記録用の `subject` だけ）
 *
 * 承認の画面は「何が起きるか」を1目で読めることが要る。切った跡は `…` で残す。
 * **切ったことで承認の対象が変わることはない**（対象を決めるのは fingerprint）。
 *
 * ## Terminal のコマンドは切らない（STEP8。2026-09-23 確定）
 *
 * Terminal の承認は**内容を省略せずに見せる。** コマンドの1行（`commandSummary`）と
 * 引数の並び（`commandArgs`）は長さで切らず、代わりに受け付ける長さそのものを
 * `APPROVAL_COMMAND_LINE_MAX_LENGTH`（2,000 文字）で抑えてある（approvalAction.ts）。
 * 切った1行を見せて承認させると、見えていない後ろの引数まで承認したことになる。
 *
 * Secret は command と引数を**まとめて探し、引数ごとに伏せる**（`maskSecretLines`。
 * STEP7 の Diff と同じ道具）── 1つずつ探すと、`Bearer` と値が別の引数に分かれた
 * ときに値が素通りする。伏せても引数の数と並びは変わらない。
 */

/** 対象名（相対 Path・コマンド名）の上限。Audit の `subject` と同じ長さ。 */
export const APPROVAL_SUBJECT_MAX_LENGTH = 120

/** 切ったことを示す印。 */
export const APPROVAL_TRUNCATION_MARK = '…'

/** 画面と記録に出してよい要約。**Secret も本文も絶対パスも持たない。** */
export type ApprovalSafeSummary = FileWriteApprovalSummary | TerminalApprovalSummary

interface FileWriteApprovalSummary {
  readonly actionKind: 'file.write'
  /** 短い対象名（Workspace 相対 Path）。 */
  readonly subject: string
  /** Workspace 相対の位置。 */
  readonly workspacePath: string | null
  readonly commandSummary: null
}

interface TerminalApprovalSummary {
  readonly actionKind: 'terminal.run'
  /** 短い対象名（Mask 済みのコマンド名。記録の `subject` に使うため 120 文字で切る）。 */
  readonly subject: string
  /** Workspace 相対の `cwd`（root は `null`）。 */
  readonly workspacePath: string | null
  /** Mask 済みのコマンドの1行。**切らない。** */
  readonly commandSummary: string
  /** Mask 済みのコマンド名（切らない）。 */
  readonly commandName: string
  /** Mask 済みの引数（数も並びも実行するものと同じ・切らない）。 */
  readonly commandArgs: readonly string[]
  /** Secret を1つ以上伏せたか。 */
  readonly secretMasked: boolean
}

/** 操作1件の安全な要約。**例外を投げない。** */
export function approvalSafeSummary(action: NormalizedApprovalAction): ApprovalSafeSummary {
  if (action.kind === 'file.write') {
    const path = safeText(action.canonicalRelativePath, APPROVAL_SUBJECT_MAX_LENGTH)

    return Object.freeze({
      actionKind: 'file.write' as const,
      subject: path,
      workspacePath: path,
      commandSummary: null
    })
  }

  /*
    末尾にも改行を置く ── 最後の引数が空文字のとき、それが「最後の改行」として
    落とされないように（splitLines は末尾の空の1行を数えない）。
  */
  const masked = maskSecretLines(`${[action.command, ...action.args].join('\n')}\n`)
  const [commandName, ...commandArgs] = masked.lines

  /*
    行の数は変わらない（maskSecretLines の約束）が、変わっていたら並びを信用できない。
    何が入っていたか分からない以上、全部を伏せる側へ倒す。
  */
  const aligned = commandName !== undefined && commandArgs.length === action.args.length
  const name = aligned ? commandName : SECRET_MASK
  const args = aligned ? commandArgs : action.args.map(() => SECRET_MASK)

  return Object.freeze({
    actionKind: 'terminal.run' as const,
    subject: safeText(action.command, APPROVAL_SUBJECT_MAX_LENGTH),
    // cwd は受け付ける上限（256 文字）までそのまま見せる（Terminal は省略しない）。
    workspacePath: action.cwd === '' ? null : safeText(action.cwd, APPROVAL_CWD_MAX_LENGTH),
    commandSummary: commandLine(name, args),
    commandName: name,
    commandArgs: Object.freeze([...args]),
    secretMasked: masked.masked || !aligned
  })
}

/**
 * Terminal の確認の本文（STEP8。2026-09-23 確定）。**省略しない。**
 *
 * 1行にまとめたコマンドだけでは、`"` を含む引数や空白を含む引数の区切りが読み分け
 * られない。そこで**実行する形そのまま**（コマンド名と、引数を1つずつ番号付きで）並べる。
 * 長さは要約の側で抑えてあり（コマンド全体 2,000 文字まで）、ここでは切らない。
 *
 * ```
 * コマンド: npm
 * 引数（2 個）:
 *   [1] run
 *   [2] test
 * 場所: Workspace のルート
 * シェルを通さずに、この形のまま1回だけ実行します。
 * ```
 */
export function describeTerminalCommand(
  summary: Extract<ApprovalSafeSummary, { readonly actionKind: 'terminal.run' }>
): string {
  const lines = [`コマンド: ${summary.commandName}`]

  if (summary.commandArgs.length === 0) {
    lines.push('引数: なし')
  } else {
    lines.push(`引数（${summary.commandArgs.length} 個）:`)
    summary.commandArgs.forEach((arg, index) => {
      lines.push(`  [${index + 1}] ${arg === '' ? '（空の引数）' : arg}`)
    })
  }

  lines.push(`場所: ${summary.workspacePath ?? 'Workspace のルート'}`)

  if (summary.secretMasked) {
    lines.push('Secret らしき値は、この表示では伏せてあります（実行には元の値が使われます）。')
  }

  lines.push('シェルを通さずに、この形のまま1回だけ実行します。')

  return lines.join('\n')
}

/**
 * 表示するコマンドの1行を組み立てる。
 *
 * 空白を含む引数は `"` で囲む ── 囲まないと、1つの引数と2つの引数が同じに見える。
 * **これは表示のための整形で、実行する形ではない**（実行するのは Command Runner が
 * 受け取る command / args そのもの）。
 */
function commandLine(command: string, args: readonly string[]): string {
  const parts = [command, ...args.map((arg) => (arg === '' || /\s/.test(arg) ? `"${arg}"` : arg))]

  return parts.join(' ')
}

/** Secret を伏せてから、長さで切る。 */
function safeText(value: string, maxLength: number): string {
  let masked: string

  try {
    masked = redactSecretText(value)
  } catch {
    // 伏せられなかった。何が入っていたか分からない以上、そのままは出さない。
    return APPROVAL_TRUNCATION_MARK
  }

  if (masked.length <= maxLength) {
    return masked
  }

  // 切った端で文字が割れないよう、コードポイントの単位で数える。
  const kept = [...masked].slice(0, maxLength - APPROVAL_TRUNCATION_MARK.length).join('')

  return `${kept}${APPROVAL_TRUNCATION_MARK}`
}
