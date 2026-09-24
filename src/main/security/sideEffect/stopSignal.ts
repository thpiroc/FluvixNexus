/**
 * 副作用を求めた側（Agent の作業）が止まったか（Security Core v1 の STEP9 の修正。2026-09-24）。
 *
 * Agent Loop は作業ごとに `AbortController` を持ち、利用者の停止・Workspace の切り替え
 * （halt）で abort する。その signal を File Write Gate / Terminal Command Runner /
 * Approval Manager まで渡し、**止まった後に新しい承認・新しい副作用を始めない**ために使う。
 *
 * ## 分からなければ止まっている
 *
 * signal を渡さない呼び出し（Agent 以外の経路。開発用の足場）は、これまでどおり
 * 「止まっていない」。渡されたのに読めない（例外）場合は、止まっていると読む。
 *
 * **止まる向きにしか働かない。** signal が「止まっていない」と言っても、承認・Boundary・
 * Policy のどれも省かない。
 */
export function isStopRequested(signal: AbortSignal | undefined): boolean {
  if (signal === undefined) {
    return false
  }

  try {
    return signal.aborted !== false
  } catch {
    return true
  }
}
