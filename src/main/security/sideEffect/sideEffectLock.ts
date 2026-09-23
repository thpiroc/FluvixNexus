import { isApprovalActionKind, type ApprovalActionKind } from '@shared/security'

/**
 * 副作用のある操作の共有ロック（Security Core v1 の STEP9。Electron にも fs にも依存しない）。
 *
 * File Write（STEP7）と Terminal（STEP8）は、**種類をまたいで同時に1件だけ**にする。
 *
 * ```
 * File Write の承認待ち    → Terminal の提案は side-effect-in-progress で拒む
 * Terminal の実行中        → File Write の提案は side-effect-in-progress で拒む
 * File Write の承認待ち    → 2件目の File Write は write-in-progress（STEP7 のまま）
 * ```
 *
 * ## Agent Loop の直列化だけに頼らない
 *
 * Agent Loop（main/agent/）も1ターン1 Action で順番に進めるが、**強制はこちらで行う**
 * （2026-09-23 確定）。Loop 以外にも Gate を呼ぶ経路（開発用の足場）があり、Loop に
 * 不具合があっても承認画面が2枚重なる・承認中に別のコマンドが走る、が起きないようにする。
 *
 * ## 持つのは提案から終わりまで
 *
 * 各 Gate は、要求を受けた直後に取り、承認・実行・結果の確認が終わってから（拒否でも
 * 例外でも）`release` する。Terminal は実行中（最大 120 秒）も持ち続ける ── 承認の画面を
 * 重ねないことに加えて、**コマンドが走っている間にファイルを書き換えない**ため。
 *
 * ## 分からなければ拒む
 *
 * 知らない種類で取ろうとした場合は取れない（`null`）。解放は取った本人の `release`
 * だけで、2回呼んでも他人のロックは外れない。ロックを外から強制的に外す API は作らない。
 */

/** 取れたロック。`release` は何度呼んでもよい（2回目以降は何もしない）。 */
export interface SideEffectLease {
  readonly kind: ApprovalActionKind
  readonly release: () => void
}

/** 取れなかったとき、今持っている操作の種類。 */
export type SideEffectAcquireResult =
  | { readonly ok: true; readonly lease: SideEffectLease }
  | { readonly ok: false; readonly heldBy: ApprovalActionKind | null }

export interface SideEffectLock {
  /** 取る。すでに誰かが持っていれば取れない。 */
  readonly acquire: (kind: unknown) => SideEffectAcquireResult
  /** 今持っている操作の種類（持っていなければ `null`）。Agent Loop の `complete` の確認に使う。 */
  readonly heldBy: () => ApprovalActionKind | null
}

export function createSideEffectLock(): SideEffectLock {
  let holder: { readonly kind: ApprovalActionKind; readonly token: object } | null = null

  function acquire(kind: unknown): SideEffectAcquireResult {
    if (!isApprovalActionKind(kind)) {
      return Object.freeze({ ok: false as const, heldBy: holder?.kind ?? null })
    }

    if (holder !== null) {
      return Object.freeze({ ok: false as const, heldBy: holder.kind })
    }

    const token = {}
    holder = { kind, token }

    return Object.freeze({
      ok: true as const,
      lease: Object.freeze({
        kind,
        release: () => {
          // 自分が取ったロックだけを外す（取り直した後の別のロックを外さない）。
          if (holder?.token === token) {
            holder = null
          }
        }
      })
    })
  }

  return Object.freeze({
    acquire,
    heldBy: () => holder?.kind ?? null
  })
}
