import type { DebugCallStackFrame, DebugCallStackSnapshot } from '@shared/debug'

/**
 * Call Stack の frame 選択（Session 6-6。純粋・テスト対象）。
 *
 * Variables は「今選んでいる frame」の Scope を読む。選択は **snapshot ごと**の
 * もので、snapshot が差し替わったら持ち越さない ── DAP の frame id は次の停止で
 * 別の frame に再利用されうるため、同じ数でも同じ frame とは限らない。
 */

/** 止まった thread の最上段。読めるものが無ければ null。 */
export function selectDefaultFrameId(snapshot: DebugCallStackSnapshot): number | null {
  if (snapshot.status !== 'stopped') {
    return null
  }

  const active =
    snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) ??
    snapshot.threads.find((thread) => thread.frames.length > 0)

  return active?.frames[0]?.id ?? null
}

export function findCallStackFrame(
  snapshot: DebugCallStackSnapshot,
  frameId: number
): DebugCallStackFrame | null {
  for (const thread of snapshot.threads) {
    const frame = thread.frames.find((candidate) => candidate.id === frameId)

    if (frame !== undefined) {
      return frame
    }
  }

  return null
}

export interface CallStackSelection {
  /** 選んだときの snapshot の版。 */
  readonly version: number
  readonly frameId: number
}

/**
 * 今の選択。利用者が選んだものが**今の版の snapshot に実在する**ときだけそれを使い、
 * そうでなければ最上段に戻す。
 */
export function resolveSelectedFrameId(
  snapshot: DebugCallStackSnapshot,
  version: number,
  selection: CallStackSelection | null
): number | null {
  if (
    snapshot.status === 'stopped' &&
    selection !== null &&
    selection.version === version &&
    findCallStackFrame(snapshot, selection.frameId) !== null
  ) {
    return selection.frameId
  }

  return selectDefaultFrameId(snapshot)
}
