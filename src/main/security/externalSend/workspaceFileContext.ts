import { isVerifiedWorkspaceTarget } from '../boundary/workspaceBoundary'
import { maskSecretLines } from '../fileWrite/secretLineMask'
import { isSecretWorkspaceTarget } from '../secret/secretFileFacts'
import { SECRET_MASK } from '../secret/secretMasking'
import { scanTargetFromBytes } from '../secret/secretScan'
import {
  EXTERNAL_SEND_ITEM_MAX_CHARS,
  EXTERNAL_SEND_LABEL_MAX_LENGTH,
  type RawExternalContextItem
} from './externalSendContext'
import type { ExternalSendDenial } from './externalSendDecision'

/**
 * Workspace のファイルを External Context にする接続点（Security Core v1 の STEP5）。
 *
 * **ここが File Read Gate（後の STEP）と External Send Gate のつなぎ目になる。**
 * 渡すのは「Boundary（STEP2）が読み取りとして発行した対象」と「そこから読んだバイト列」の
 * 2つだけで、**文字列を組み立てるのはこの関数**にあたる ── Agent が
 * `{ kind: 'workspace-file', text: '…' }` を手で組んで、Boundary を通っていない中身を
 * ファイルとして載せる形を避けるため。
 *
 * ```
 * File Read Gate（後の STEP）
 *   ↓ VerifiedWorkspaceTarget（STEP2）＋ 読んだバイト列
 * workspaceFileContext()          ← ここ
 *   ↓ RawExternalContextItem（source 付き）
 * decideExternalSend()            もう一度 Boundary / Secret / Policy を通す
 * ```
 *
 * **この関数を通ったことは、Gate では信用されない。** Gate は `source` から
 * `agentFileReadFacts` を作り直して自分で判定する（二重に確かめる）。
 *
 * ## fs には触れない
 *
 * ファイルを開くのは後の STEP の Gate の役目で、ここは「開いた結果の扱い」だけを決める
 * （secretScan.ts と同じ線）。binary・大きすぎるもの・読めなかったものは、
 * **文字列にせずに拒む。**
 */

/**
 * 読む行の範囲（STEP9。1 から数える・両端を含む）。
 *
 * 範囲の外の行は Context に入れない。`endLine` がファイルの行数を超えていれば、
 * 最後の行までで止める。
 */
export interface WorkspaceFileRange {
  readonly startLine: number
  readonly endLine: number
}

/** 範囲を指定して作ったときの、切り出した位置（Agent へ「どこを読んだか」を返すため）。 */
export interface WorkspaceFileExcerpt {
  /** 実際に切り出した最初の行（ファイルが空・範囲がファイルの外なら 0）。 */
  readonly startLine: number
  /** 実際に切り出した最後の行（同上なら 0）。 */
  readonly endLine: number
  /** ファイル全体の行数。 */
  readonly totalLines: number
  /** 切り出した範囲の中に、伏せた箇所があるか。 */
  readonly secretMasked: boolean
}

export type WorkspaceFileContextResult =
  | {
      readonly ok: true
      readonly item: RawExternalContextItem
      /** 範囲を指定したときだけ付く。 */
      readonly excerpt?: WorkspaceFileExcerpt
    }
  | { readonly ok: false; readonly reason: ExternalSendDenial }

/**
 * 確かめた対象と、読んだバイト列から Context 1件を作る。
 *
 * `label` には実体の綴り（`canonicalRelativePath`）を入れる ── どのファイルの中身かは
 * Provider へ渡す Context として要るが、**絶対パスは渡さない**（利用者の名前・PC の
 * 構成が乗るため）。
 *
 * ## 範囲の指定（STEP9。file_read）
 *
 * `range` を渡すと、その行だけを Context にする。**Secret はファイル全体で探し、
 * 行ごとに伏せてから切り出す**（fileWrite/secretLineMask.ts）── 切り出してから伏せると、
 * Private Key の BEGIN が範囲の外にあるとき、範囲に入った鍵の本体の行が
 * 「ただの Base64」として素通りする。
 *
 * 切り出した後も `kind: 'workspace-file'` と `source`（Boundary の対象）はそのまま持つ。
 * External Send Gate は受け取った `source` から Secret ファイルかを**もう一度**判定し、
 * 本文も**もう一度** Mask する（2026-09-23 確定: 範囲指定は Security Core 側で扱う）。
 */
export function workspaceFileContext(
  target: unknown,
  bytes: unknown,
  range?: unknown
): WorkspaceFileContextResult {
  if (!isVerifiedWorkspaceTarget(target) || target.access !== 'read') {
    return failure('outside-workspace')
  }

  if (isSecretWorkspaceTarget(target)) {
    // `.env` / 秘密鍵などは、伏せて送るのではなく Context へ入れない（DESIGN.md §6.4）。
    return failure('secret-file')
  }

  const scanned = scanTargetFromBytes(bytes)

  switch (scanned.kind) {
    case 'binary':
      return failure('unsupported-context')

    case 'too-large':
      return failure('context-too-large')

    case 'unreadable':
      return failure('unverifiable')

    case 'text':
      break
  }

  if (scanned.text.length > EXTERNAL_SEND_ITEM_MAX_CHARS) {
    return failure('context-too-large')
  }

  const label = target.canonicalRelativePath
  const labelField = label.length <= EXTERNAL_SEND_LABEL_MAX_LENGTH ? label : undefined

  if (range === undefined) {
    return Object.freeze({
      ok: true as const,
      item: Object.freeze({
        kind: 'workspace-file' as const,
        text: scanned.text,
        label: labelField,
        source: target
      })
    })
  }

  const lines = readRange(range)

  if (lines === null) {
    return failure('invalid-payload')
  }

  const excerpt = excerptOf(scanned.text, lines)

  return Object.freeze({
    ok: true as const,
    item: Object.freeze({
      kind: 'workspace-file' as const,
      text: excerpt.text,
      label: labelField,
      source: target
    }),
    excerpt: excerpt.position
  })
}

/** 範囲として読める値か（1 以上の整数・start ≦ end）。 */
function readRange(range: unknown): WorkspaceFileRange | null {
  if (typeof range !== 'object' || range === null) {
    return null
  }

  const { startLine, endLine } = range as {
    readonly startLine?: unknown
    readonly endLine?: unknown
  }

  if (
    typeof startLine !== 'number' ||
    typeof endLine !== 'number' ||
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  ) {
    return null
  }

  return { startLine, endLine }
}

/** 全体を伏せてから、範囲の行だけを切り出す。 */
function excerptOf(
  text: string,
  range: WorkspaceFileRange
): { readonly text: string; readonly position: WorkspaceFileExcerpt } {
  const masked = maskSecretLines(text)
  const totalLines = masked.lines.length

  if (totalLines === 0 || range.startLine > totalLines) {
    return {
      text: '',
      position: Object.freeze({ startLine: 0, endLine: 0, totalLines, secretMasked: false })
    }
  }

  const endLine = Math.min(range.endLine, totalLines)
  const selected = masked.lines.slice(range.startLine - 1, endLine)

  return {
    text: selected.join('\n'),
    position: Object.freeze({
      startLine: range.startLine,
      endLine,
      totalLines,
      secretMasked: selected.some((line) => line.includes(SECRET_MASK))
    })
  }
}

function failure(reason: ExternalSendDenial): WorkspaceFileContextResult {
  return Object.freeze({ ok: false as const, reason })
}
