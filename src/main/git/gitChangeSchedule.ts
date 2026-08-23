/**
 * `.git` の変化を「いつ配るか」だけを決める層（fs にも Electron にも依存しない）。
 *
 * 監視そのものは gitWatcher.ts が持ち、ここが持つのは**時刻の計算1つ**になる。
 * 分けてあるのは、この判断がいちばん壊れやすく、いちばん試しにくい場所だから
 * ── `setTimeout` と `fs.watch` の中に埋めると、確かめる手段が
 * 「実際に checkout してみる」しか無くなる。
 *
 * ## 3つの線で挟む
 *
 * ```
 *   静まるまで待つ（COALESCE）      … 最後の変化から 250ms
 *   待ちすぎない（MAX_COALESCE）    … 最初の変化から 1s で必ず配る
 *   配りすぎない（MIN_INTERVAL）    … 前に配ってから 500ms は空ける
 * ```
 *
 * **1つでは足りない。**
 *
 * 静まるまで待つだけだと、`git checkout` のように**書き込みが数秒続く**操作で
 * いつまでも配られない（利用者はブランチが切り替わった画面を見ているのに、
 * パネルだけが前のままになる）。だから最初の変化からの上限を置く。
 *
 * 上限だけだと、今度は連続する操作（`git add` を続けて叩く・`git fetch` の
 * 途中）で 1 秒ごとに `git status` が走り続ける。だから前回からの間隔も置く。
 *
 * ## 値の決め方
 *
 * Renderer 側でも 0.4 秒束ねてから調べる（useGitRepository.ts の
 * `CHANGE_SETTLE_MS`）ため、利用者から見た遅れは最大で 250ms + 400ms になる。
 * 「端末で `git add` してパネルへ目を移す」より速ければよく、
 * それより短くしても**プロセス起動の回数が増えるだけ**で見え方は変わらない。
 */

/** 最後の変化から、これだけ静かなら配る。 */
export const GIT_CHANGE_COALESCE_MS = 250

/** 最初の変化から、これを超えたら静まっていなくても配る。 */
export const GIT_CHANGE_MAX_COALESCE_MS = 1000

/** 前に配ってから、これだけは空ける。 */
export const GIT_CHANGE_MIN_INTERVAL_MS = 500

export interface GitChangeTiming {
  /** 今の時刻。 */
  readonly now: number
  /** 溜まっている変化のうち、最初のものが届いた時刻。 */
  readonly firstPendingAt: number
  /** 前に配った時刻。まだ一度も配っていなければ null。 */
  readonly lastEmittedAt: number | null
}

/**
 * 次に配るまで待つ時間（ミリ秒）。
 *
 * 変化が1つ届くたびに呼び直し、返った時間でタイマーを取り直す。
 * **必ず 0 以上**を返す（`setTimeout` に負の値を渡さない）。
 */
export function nextGitChangeDelayMs(timing: GitChangeTiming): number {
  const { now, firstPendingAt, lastEmittedAt } = timing

  // 静まるまで待つ。ただし最初の変化からの上限は超えない。
  const settleAt = Math.min(
    now + GIT_CHANGE_COALESCE_MS,
    firstPendingAt + GIT_CHANGE_MAX_COALESCE_MS
  )

  /*
    前に配った直後なら、そこから間隔を空ける。

    上限（MAX_COALESCE）より**こちらを優先する** ── 上限は「遅れないため」の線で、
    間隔は「暴れないため」の線になる。押し寄せている最中に遅れを取り戻しても、
    出てくるのは同じ `git status` の連射でしかない。
  */
  const earliestAt = lastEmittedAt === null ? settleAt : lastEmittedAt + GIT_CHANGE_MIN_INTERVAL_MS

  return Math.max(0, Math.max(settleAt, earliestAt) - now)
}
