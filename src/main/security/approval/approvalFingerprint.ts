import { createHash } from 'crypto'
import type { NormalizedApprovalAction } from './approvalAction'

/**
 * 承認と実行を結び付ける fingerprint（Security Core v1 の STEP6。Electron に依存しない）。
 *
 * 「file.write が承認済み」という**汎用の印**を作らないための仕掛け。承認したときと
 * 実行する直前の両方で**同じ関数**から作り、一致しなければ実行しない
 * （approvalManager.ts の consume）。
 *
 * ```
 * file.write    action ＋ 実体の綴り（canonical）      ＋ 本文の SHA-256
 * terminal.run  action ＋ command ＋ 引数の数 ＋ 各引数 ＋ cwd
 * ```
 *
 * ## 境目を数で区切る
 *
 * 材料はそのままつなげず、**1つずつ「バイト数 ＋ 値」の形にしてからつなぐ。**
 * 素のつなぎ方（`parts.join(':')` など）では、`['a:b', 'c']` と `['a', 'b:c']` が
 * 同じ文字列になる ── 承認した引数と違う区切り方の引数が、同じ fingerprint を
 * 名乗れることになる。
 *
 * ## 承認の対象そのものは保存しない
 *
 * 本文は先に SHA-256 へ畳んでから材料にする。Approval Manager が持つのは
 * ここが返す hex 文字列だけで、**本文も引数も保持しない**（approvalManager.ts）。
 *
 * ## hash にすれば何でも記録してよい、ではない
 *
 * fingerprint は「同じものか」を確かめるためだけの値で、Audit へ**本文の代わりに
 * 残す**ものではない。Secret を hash 化して保存すれば安全、という扱いにはしない
 * （DESIGN.md §6.4）。STEP6 では Audit Log にも fingerprint を書かない。
 *
 * ## 作れなければ拒む
 *
 * hash が使えない環境・材料を読めない場合は `null` を返す。呼び出し側は
 * `fingerprint-failed` として**拒否**する（承認を作らない・実行しない）。
 */

/** fingerprint（SHA-256 の hex）。 */
export type ApprovalFingerprint = string

/** 操作1件の fingerprint。**作れなければ `null`。例外を投げない。** */
export function approvalFingerprint(action: NormalizedApprovalAction): ApprovalFingerprint | null {
  try {
    return action.kind === 'file.write'
      ? digest([
          'file.write',
          action.canonicalRelativePath,
          // 本文はここで畳む。以後、本文そのものは持ち回らない。
          digestText(action.content)
        ])
      : digest([
          'terminal.run',
          action.command,
          // 引数の数も材料に入れる（数が変われば必ず別の fingerprint になる）。
          String(action.args.length),
          ...action.args,
          action.cwd
        ])
  } catch {
    return null
  }
}

/** 材料を「バイト数 ＋ 値」の形でつないでから畳む。 */
function digest(parts: readonly string[]): ApprovalFingerprint {
  const encoded = parts.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('\n')

  return digestText(encoded)
}

function digestText(text: string): ApprovalFingerprint {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
