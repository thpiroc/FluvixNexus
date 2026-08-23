/**
 * シェルの出力を束ねてから配る（Electron / fs / node-pty 非依存・テスト対象）。
 *
 * ## なぜ要るか
 *
 * node-pty の `onData` は細かく何度も呼ばれる。`ls` 1回でも数回、
 * `npm install` のような出力なら毎秒数千回になる。これを1回ずつ
 * `emitIpcEvent` に渡すと、**IPC の往復回数が出力の細かさに比例する。**
 * 中身は同じなので、束ねればその回数だけが減る。
 *
 * ファイル変更の通知（main/files/workspaceWatcher.ts）が束ねているのと
 * 目的は同じだが、**扱いが1つだけ違う。**
 *
 * ```
 * files:changed   束ねて、畳んで、上限で間引く（MAX_CHANGES_PER_BATCH）
 * terminal:data   束ねるだけ。畳まないし、間引かない
 * ```
 *
 * ファイルの変化は「同じ位置に3回起きた」を1回に畳んでよく、多すぎれば
 * 捨ててよい ── 受け手は結局そのフォルダを読み直すので、正しい状態に追いつける。
 * ターミナルの出力にその性質は無い。1回きりで、順番に意味があり、
 * **落とした分を後から取り戻す手段が無い**（消えた文字の分だけ画面が壊れる）。
 * したがってここでの上限は「捨てる基準」ではなく「**待たずに送る基準**」になる。
 *
 * ## 2つの基準で送る
 *
 * | 基準           | 何のためか                                                    |
 * | -------------- | ------------------------------------------------------------- |
 * | 短い時間       | 打鍵の反響（echo）が遅れて見えないこと。1フレーム分に収める   |
 * | 溜まった長さ   | 大量出力のときにメモリを溜め込まないこと                      |
 *
 * 時間だけだと、出力が続く限り送るのは一定間隔でも1回あたりが際限なく太る。
 * 長さだけだと、1文字打っただけの反響がいつまでも出ない。
 *
 * ## 時計を引数で受け取らない
 *
 * `setTimeout` をそのまま使う。Electron にも fs にも触れないため、
 * テストは偽のタイマー（vitest の `vi.useFakeTimers`）で動かせる。
 */

/**
 * 束ねる時間（ミリ秒）。
 *
 * 打鍵の反響が「引っかかる」と感じられない範囲に収める必要がある。
 * おおよそ1フレーム分にしてあり、これ以上長くすると、文字を打ってから
 * 画面に出るまでの遅れとして直接感じられる。
 */
export const TERMINAL_OUTPUT_FLUSH_INTERVAL_MS = 16

/**
 * 待たずに送る長さ（文字数）。
 *
 * ここに達したら時間を待たない。上限ではないので、**超えた分を捨てはしない**
 * （このファイルの冒頭）。
 */
export const TERMINAL_OUTPUT_FLUSH_LENGTH = 64 * 1024

export interface OutputCoalescer {
  /** 届いた出力を受け取る。送るかどうかはこちらが決める。 */
  readonly push: (chunk: string) => void
  /** 溜まっているものを今すぐ送る（プロセスが終わったときなど）。 */
  readonly flush: () => void
  /** 溜まっているものを捨てて終わる。送らない。 */
  readonly dispose: () => void
}

export function createOutputCoalescer(emit: (data: string) => void): OutputCoalescer {
  /*
    配列で持って最後に join する。文字列に `+=` で足していくと、
    大量出力のときに毎回コピーが起きる（結合のたびに全長ぶん）。
  */
  let pending: string[] = []
  let pendingLength = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function flush(): void {
    clearTimer()

    if (pending.length === 0) {
      return
    }

    const data = pending.join('')
    pending = []
    pendingLength = 0

    emit(data)
  }

  return {
    push: (chunk: string): void => {
      /*
        捨てた後に届いたもの。node-pty は kill の後にも最後の出力を渡してくることが
        あるため、来ないことを前提にしない。
      */
      if (disposed || chunk.length === 0) {
        return
      }

      pending.push(chunk)
      pendingLength += chunk.length

      if (pendingLength >= TERMINAL_OUTPUT_FLUSH_LENGTH) {
        flush()
        return
      }

      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          flush()
        }, TERMINAL_OUTPUT_FLUSH_INTERVAL_MS)
      }
    },

    flush: (): void => {
      if (disposed) {
        return
      }

      flush()
    },

    dispose: (): void => {
      disposed = true
      clearTimer()
      pending = []
      pendingLength = 0
    }
  }
}
