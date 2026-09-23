import { isApprovalActionKind, type ApprovalActionKind } from '@shared/security'
import { isVerifiedWorkspaceTarget } from '../boundary/workspaceBoundary'
import type { VerifiedWorkspaceTarget } from '../boundary/workspaceBoundary'

/**
 * 承認を求める操作1件を、Main が扱ってよい形にする（Security Core v1 の STEP6。Electron に依存しない）。
 *
 * Approval Manager が受け取るのは**型を名乗っているだけの値**で、ここを通るまでは
 * 何も確かめられていない。通った後の `NormalizedApprovalAction` だけが、
 *
 *   - Policy（STEP1）の判定にかけられ
 *   - fingerprint（approvalFingerprint.ts）の材料になり
 *   - 表示用の安全な要約（approvalSummary.ts）になる
 *
 * ## File Write は Boundary が確かめた対象しか受け取らない
 *
 * 書き込み先は文字列ではなく **Boundary（STEP2）が書き込みとして発行した
 * `VerifiedWorkspaceTarget`** で受け取る。Agent・Renderer・FN Engine が
 * `'src/app.ts'` のような文字列や `{ insideWorkspace: true }` のような自己申告を
 * 渡せる口は作らない ── 承認の対象を決めるのが申告になれば、承認そのものが
 * 申告になるため。対象の綴りは `canonicalRelativePath`（ディスク上の実体の綴り）を使う。
 *
 * ## Terminal は実行する形そのものを受け取る
 *
 * `command` と `args` を**分けたまま**受け取る。1本の文字列にして受け取ると、
 * 承認した文字列と実行する配列の対応が Gate 側の組み立て方に委ねられ、
 * 「承認した文字列とは違う引数で実行する」形が作れてしまう。`cwd` は
 * **Workspace 相対**（`''` が root）だけを受け取る ── 絶対パスは表示にも
 * Audit にも出さず、実体への解決は Command Runner（STEP8）が Workspace root から行う。
 *
 * ## 本文と出力は「材料」であって「持ち物」ではない
 *
 * `content` は fingerprint を作るためだけに通る。**Approval Manager はこれを保持しない**
 * （approvalManager.ts）。raw な Terminal の出力にあたる欄は、この型にも無い。
 *
 * ## 判断できなければ拒む
 *
 * 種類が分からない・形が違う・上限を超える・制御文字が混ざる、はすべて拒否側へ倒す。
 * 縮めて通す（truncate）ことはしない ── 落とした部分が「承認された」ことになるため。
 */

/** 表示にも fingerprint にも使えない形を拒む理由。STEP1 の語をそのまま使う。 */
export type ApprovalActionDenial = 'invalid-request' | 'unknown-action'

/** コマンド名の上限。 */
export const APPROVAL_COMMAND_MAX_LENGTH = 256

/** 引数1つの上限。 */
export const APPROVAL_ARG_MAX_LENGTH = 512

/** 引数の数の上限。 */
export const APPROVAL_MAX_ARGS = 64

/** `cwd`（Workspace 相対）の上限。 */
export const APPROVAL_CWD_MAX_LENGTH = 256

/**
 * コマンド全体（command ＋ 各引数。区切りの空白1つずつを含む）の上限（STEP8。2026-09-23 確定）。
 *
 * Terminal の承認は**内容を省略せずに見せる**（DESIGN.md §6.4）。1つずつの上限
 * （512 文字 × 64 個）だけでは 3 万文字を超える提案が通り、画面でも Native Dialog でも
 * 読み切れない ── 読み切れないものを承認させないため、全体をここで抑える。
 * 超えたものは縮めずに拒む。
 */
export const APPROVAL_COMMAND_LINE_MAX_LENGTH = 2_000

/**
 * 書き込む本文の上限（文字数）。
 *
 * STEP3 の `SECRET_SCAN_MAX_CHARS` と同じ値。承認を求める段階で、後の Gate が
 * Secret の検査を最後まで実行できない大きさのものを通さないため。
 */
export const APPROVAL_CONTENT_MAX_CHARS = 1_000_000

/** Approval Manager へ渡す、未検査の要求。 */
export type RawApprovalRequest =
  | {
      readonly kind: 'file.write'
      /** Boundary（STEP2）が**書き込みとして**発行した対象。 */
      readonly target: unknown
      /** 書き込む予定の本文。fingerprint の材料としてだけ通る。 */
      readonly content: string
    }
  | {
      readonly kind: 'terminal.run'
      readonly command: string
      readonly args: readonly string[]
      /** Workspace 相対の作業ディレクトリ（`''` が root）。 */
      readonly cwd: string
    }

/** 確かめた後の操作。**この module が作ったものだけ**が Manager の先へ進める。 */
export type NormalizedApprovalAction =
  | {
      readonly kind: 'file.write'
      readonly target: VerifiedWorkspaceTarget
      /** ディスク上の実体の綴り（Workspace 相対・区切りは `/`）。 */
      readonly canonicalRelativePath: string
      readonly content: string
    }
  | {
      readonly kind: 'terminal.run'
      readonly command: string
      readonly args: readonly string[]
      readonly cwd: string
    }

export type ApprovalActionResult =
  | { readonly ok: true; readonly action: NormalizedApprovalAction }
  | { readonly ok: false; readonly denial: ApprovalActionDenial }

/**
 * 要求の種類だけを読む（拒んだときの Audit に載せるため）。
 *
 * 形が読めない・知らない種類なら `null`。**読めた種類を「承認してよい」と
 * 読み替えることはしない** ── これは記録のための値にあたる。
 */
export function approvalActionKindOf(raw: unknown): ApprovalActionKind | null {
  if (!isRecord(raw)) {
    return null
  }

  try {
    return isApprovalActionKind(raw.kind) ? raw.kind : null
  } catch {
    return null
  }
}

/** 未検査の要求を、扱ってよい形にする。**例外を投げない。** */
export function normalizeApprovalRequest(raw: unknown): ApprovalActionResult {
  try {
    return normalize(raw)
  } catch {
    return DENIED.invalidRequest
  }
}

function normalize(raw: unknown): ApprovalActionResult {
  if (!isRecord(raw)) {
    return DENIED.invalidRequest
  }

  if (!isApprovalActionKind(raw.kind)) {
    return DENIED.unknownAction
  }

  return raw.kind === 'file.write' ? normalizeFileWrite(raw) : normalizeTerminalRun(raw)
}

function normalizeFileWrite(raw: Readonly<Record<string, unknown>>): ApprovalActionResult {
  const target: unknown = raw.target

  // 書き込みとして確かめた対象だけ。読み取りとして確かめた対象も流用させない。
  if (!isVerifiedWorkspaceTarget(target) || target.access !== 'write') {
    return DENIED.invalidRequest
  }

  const canonicalRelativePath = target.canonicalRelativePath

  if (!isUsableRelativePath(canonicalRelativePath) || canonicalRelativePath === '') {
    return DENIED.invalidRequest
  }

  const content: unknown = raw.content

  if (typeof content !== 'string' || content.length > APPROVAL_CONTENT_MAX_CHARS) {
    return DENIED.invalidRequest
  }

  return {
    ok: true,
    action: Object.freeze({
      kind: 'file.write' as const,
      target,
      canonicalRelativePath,
      content
    })
  }
}

function normalizeTerminalRun(raw: Readonly<Record<string, unknown>>): ApprovalActionResult {
  const command: unknown = raw.command

  if (
    typeof command !== 'string' ||
    command.length === 0 ||
    command.length > APPROVAL_COMMAND_MAX_LENGTH ||
    command.trim() !== command ||
    hasControlCharacter(command) ||
    hasInvisibleCharacter(command)
  ) {
    return DENIED.invalidRequest
  }

  const rawArgs: unknown = raw.args

  if (!Array.isArray(rawArgs) || rawArgs.length > APPROVAL_MAX_ARGS) {
    return DENIED.invalidRequest
  }

  const args: string[] = []

  for (const arg of rawArgs as readonly unknown[]) {
    if (
      typeof arg !== 'string' ||
      arg.length > APPROVAL_ARG_MAX_LENGTH ||
      hasControlCharacter(arg) ||
      hasInvisibleCharacter(arg)
    ) {
      return DENIED.invalidRequest
    }

    args.push(arg)
  }

  // 省略せずに見せられる長さか（STEP8）。区切りの空白も数える。
  if (commandLineLength(command, args) > APPROVAL_COMMAND_LINE_MAX_LENGTH) {
    return DENIED.invalidRequest
  }

  const cwd: unknown = raw.cwd

  if (
    typeof cwd !== 'string' ||
    cwd.length > APPROVAL_CWD_MAX_LENGTH ||
    !isUsableRelativePath(cwd)
  ) {
    return DENIED.invalidRequest
  }

  return {
    ok: true,
    action: Object.freeze({
      kind: 'terminal.run' as const,
      command,
      args: Object.freeze([...args]),
      cwd
    })
  }
}

/**
 * Workspace 相対として受け付ける綴りか（`''` は root）。
 *
 * `..` を含む・絶対パス・ドライブレター・逆斜線・制御文字は受け付けない。
 * Boundary（STEP2）の解決をここでやり直すわけではなく、**表示と fingerprint に
 * 使ってよい形か**だけを見る。
 */
function isUsableRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || hasControlCharacter(value)) {
    return false
  }

  if (value === '') {
    return true
  }

  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) {
    return false
  }

  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** 制御文字（C0 / DEL）を含むか。表示・記録・fingerprint のどれにも入れない。 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0

    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }

  return false
}

/**
 * 見た目に現れない・見た目を組み替える文字を含むか（Terminal だけ。STEP8）。
 *
 * C1 制御文字・書式文字（双方向の上書き・ゼロ幅・BOM）・行 / 段落の区切り・
 * 対になっていないサロゲート。**画面に出た文字列と実行される文字列が同じに
 * 読めない**ものは、伏せ字や印に置き換えて見せるのではなく拒む ── 置き換えて
 * 見せると、利用者が見たものと実行されるものが別物になる。
 */
function hasInvisibleCharacter(value: string): boolean {
  return INVISIBLE_CHARACTER.test(value)
}

const INVISIBLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u

/** 表示する1行の長さ（command と各引数を空白1つで区切った長さ）。 */
function commandLineLength(command: string, args: readonly string[]): number {
  return args.reduce((total, arg) => total + 1 + arg.length, command.length)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const DENIED = Object.freeze({
  invalidRequest: Object.freeze({ ok: false as const, denial: 'invalid-request' as const }),
  unknownAction: Object.freeze({ ok: false as const, denial: 'unknown-action' as const })
})
