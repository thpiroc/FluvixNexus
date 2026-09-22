import { fileReadTargetFacts, fileWriteTargetFacts } from '../boundary/boundaryFacts'
import { isVerifiedWorkspaceTarget } from '../boundary/workspaceBoundary'
import type { FileTargetFacts, FileWriteTargetFacts } from '../policy/securityDecision'
import { classifySecretPath } from './secretPaths'

/**
 * Boundary（STEP2）の結果と Secret ファイルの判定（STEP3）を合成する。
 *
 * ```
 * resolveAgentWorkspaceTarget()    Main がディスクを見て確かめる（STEP2）
 *        ↓ VerifiedWorkspaceTarget
 * agentFileReadFacts() / agentFileWriteFacts()   ← ここ
 *        ↓ FileTargetFacts（insideWorkspace / secretFile / hardLink）
 * decideSecurityAction()           allow / ask / deny（STEP1）
 * ```
 *
 * STEP2 の boundaryFacts.ts は `secretFile` を引数で受け取るだけで、自分では調べない。
 * **その引数をどこから作るかを、ここで1つに決める。** Agent・Renderer・FN Engine から
 * `{ secretFile: false }` のような申告を受け取る口は無い ── Boundary が発行した対象
 * でなければ（同じ形に写したオブジェクトでも）、`isVerifiedWorkspaceTarget` が
 * 偽になり、拒否になる事実しか生まれない。
 *
 * ## 指した綴りと実体の綴りの両方を見る
 *
 * `requestedRelativePath`（Agent が指した綴り）と `canonicalRelativePath`
 * （ディスク上の実体の綴り）の**どちらかが** Secret ファイルなら Secret として扱う。
 * 片方だけでは足りない ──
 *
 *   - 実体だけを見る … `.env` を指す link を `notes.txt` として置けば通ってしまう
 *   - 指した綴りだけを見る … `notes.txt` を指して `.env` の中身を読めてしまう
 *
 * ## 判定できなければ Secret
 *
 * 対象が Boundary のものでない・綴りが読めない・分類が例外で落ちた、はすべて
 * 「Secret ファイル」に倒す（DESIGN.md §6.4 の fail closed）。
 *
 * Boundary の `index.ts` ではなく中の module を直に読んでいるのは、入口が
 * `resolveAgentWorkspaceTarget`（Electron の Workspace を見る）を含み、
 * Vitest から読み込めなくなるため（vitest.config.ts）。
 */

/**
 * 確かめた対象が Secret ファイルか。
 *
 * **`false` を返すのは、Boundary が発行した対象の綴りを両方読んで、どちらも
 * Secret ではないと確かめられたときだけ。**
 */
export function isSecretWorkspaceTarget(target: unknown): boolean {
  if (!isVerifiedWorkspaceTarget(target)) {
    return true
  }

  try {
    return (
      classifySecretPath(target.canonicalRelativePath) === 'secret-file' ||
      classifySecretPath(target.requestedRelativePath) === 'secret-file'
    )
  } catch {
    return true
  }
}

/** 読み取りの事実（STEP1 の `decideSecurityAction` へそのまま渡せる形）。 */
export function agentFileReadFacts(target: unknown): FileTargetFacts {
  return fileReadTargetFacts(target, isSecretWorkspaceTarget(target))
}

/** 書き込みの事実（STEP1 の `decideSecurityAction` へそのまま渡せる形）。 */
export function agentFileWriteFacts(target: unknown): FileWriteTargetFacts {
  return fileWriteTargetFacts(target, isSecretWorkspaceTarget(target))
}
