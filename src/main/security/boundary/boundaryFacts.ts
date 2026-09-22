import type { FileTargetFacts, FileWriteTargetFacts } from '../policy'
import { isVerifiedWorkspaceTarget } from './workspaceBoundary'

/**
 * Boundary の結果から、Security Decision（STEP1）へ渡す事実を作る（Security Core v1 の STEP2）。
 *
 * decideSecurityAction() は `insideWorkspace` / `hardLink` / `secretFile` を読むだけで、
 * 自分では調べない。その値を**どこから作るか**をここで1つに決める。
 *
 * ```
 * resolveWorkspaceTarget()   Main がディスクを見て確かめる
 *        ↓ VerifiedWorkspaceTarget（この module が作ったものだけ有効）
 * fileReadTargetFacts() / fileWriteTargetFacts()
 *        ↓ FileTargetFacts / FileWriteTargetFacts
 * decideSecurityAction()
 * ```
 *
 * 引数は `unknown` で受ける。Boundary が作った対象でなければ ── Agent や Renderer から
 * 届いた同じ形のオブジェクトでも、`{ insideWorkspace: true }` のような自己申告でも ──
 * **拒否になる事実**（外・hard link・Secret）を返す。検証済みを表す真偽値を
 * 外から受け取る口は無い。
 *
 * ## Secret ファイルは合成する
 *
 * Secret ファイルかどうかは Secret Detection（STEP3）が Main 側で決める。ここは
 * その結果を `secretFile` として受け取り、Boundary の事実と合わせるだけ。
 * `false`（Secret ではないと確かめた）以外はすべて Secret と読むため、
 * **STEP3 が入るまでは、この経路の判定は必ず `secret-file` で拒否になる。**
 * STEP3 は対象の `canonicalRelativePath`（実体の綴り）と `requestedRelativePath`
 * （指された綴り）の両方を見て、この引数を作る。
 */

/**
 * 読み取りの事実。
 *
 * **読み取りとして確かめた対象**でなければ Workspace の外と読む（書き込みとして確かめた
 * 対象は、まだ無いファイルであることがある）。hard link は読み取りでは理由にしない。
 */
export function fileReadTargetFacts(target: unknown, secretFile: unknown): FileTargetFacts {
  if (!isVerifiedWorkspaceTarget(target) || target.access !== 'read') {
    return Object.freeze({ insideWorkspace: false, secretFile: true })
  }

  return Object.freeze({ insideWorkspace: true, secretFile: secretFile !== false })
}

/**
 * 書き込みの事実。
 *
 * **書き込みとして確かめた対象**でなければ Workspace の外と読む。読み取りとして確かめた
 * 対象は、ディレクトリであることもリンク数を見ていないこともあるため流用させない。
 *
 * hard link は、既存のファイルでリンク数がちょうど 1 のときだけ `false`。
 * まだ無いファイルは `false`（作るファイルは他の名前を持たない）。
 */
export function fileWriteTargetFacts(target: unknown, secretFile: unknown): FileWriteTargetFacts {
  if (!isVerifiedWorkspaceTarget(target) || target.access !== 'write') {
    return Object.freeze({ insideWorkspace: false, secretFile: true, hardLink: true })
  }

  const { state } = target
  const hardLink =
    state.kind === 'missing' ? false : !(state.kind === 'file' && state.linkCount === 1n)

  return Object.freeze({
    insideWorkspace: true,
    secretFile: secretFile !== false,
    hardLink
  })
}
