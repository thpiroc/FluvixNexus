import { createSideEffectLock, type SideEffectAcquireResult } from './sideEffectLock'

/**
 * 今の副作用ロック（Security Core v1 の STEP9）。
 *
 * **Main の process に1つだけ。** File Write Gate（currentFileWriteGate.ts）と
 * Terminal Command Runner（currentTerminalRunGate.ts）が同じものを使う。
 * 差し替えられる形（`createSideEffectLock`）はこの folder の中だけにある。
 *
 * メモリだけに持ち、ディスクへは書かない（再起動で消える方が安全。承認と同じ）。
 */

const lock = createSideEffectLock()

/** 副作用のある操作を始める前に取る（Gate だけが呼ぶ）。 */
export function acquireSideEffect(kind: unknown): SideEffectAcquireResult {
  return lock.acquire(kind)
}

/** 副作用のある操作が承認待ち・実行中か（Agent Loop の `complete` の確認に使う）。 */
export function isSideEffectInProgress(): boolean {
  return lock.heldBy() !== null
}
