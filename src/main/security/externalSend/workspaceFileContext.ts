import { isVerifiedWorkspaceTarget } from '../boundary/workspaceBoundary'
import { isSecretWorkspaceTarget } from '../secret/secretFileFacts'
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

export type WorkspaceFileContextResult =
  | { readonly ok: true; readonly item: RawExternalContextItem }
  | { readonly ok: false; readonly reason: ExternalSendDenial }

/**
 * 確かめた対象と、読んだバイト列から Context 1件を作る。
 *
 * `label` には実体の綴り（`canonicalRelativePath`）を入れる ── どのファイルの中身かは
 * Provider へ渡す Context として要るが、**絶対パスは渡さない**（利用者の名前・PC の
 * 構成が乗るため）。
 */
export function workspaceFileContext(target: unknown, bytes: unknown): WorkspaceFileContextResult {
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

  return Object.freeze({
    ok: true as const,
    item: Object.freeze({
      kind: 'workspace-file' as const,
      text: scanned.text,
      label: label.length <= EXTERNAL_SEND_LABEL_MAX_LENGTH ? label : undefined,
      source: target
    })
  })
}

function failure(reason: ExternalSendDenial): WorkspaceFileContextResult {
  return Object.freeze({ ok: false as const, reason })
}
