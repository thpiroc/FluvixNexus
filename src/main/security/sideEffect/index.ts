/**
 * 副作用のある操作の共有ロック（Security Core v1 の STEP9）。
 *
 * ```
 * acquireSideEffect(kind)     File Write / Terminal の Gate が、提案を受けた直後に取る
 * isSideEffectInProgress()    承認待ち・実行中が残っていないか（Agent Loop の complete）
 * ```
 *
 * **ロックを外から外す・飛ばす API は作らない。** 解放は取った Gate の `release` だけ。
 * 公開する名前は sideEffectSurface.test.ts が固定している。
 */
export { acquireSideEffect, isSideEffectInProgress } from './currentSideEffectLock'

export type { SideEffectAcquireResult, SideEffectLease } from './sideEffectLock'
