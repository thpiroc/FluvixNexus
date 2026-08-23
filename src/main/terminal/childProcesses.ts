import { execFile } from 'child_process'
import type { PlatformId } from '@shared/api'
import { resolveSystemPowerShell } from './shellCommand'

/**
 * シェルが「何かを実行しているか」を OS に聞く層（Session 3-7-4）。
 *
 * ## 何を実行中と見なすか
 *
 * **そのシェルのプロセスが子プロセスを持っているか**、それだけを見る。
 *
 * ```
 * プロンプトで待っているだけ … 子プロセスは1つも居ない   → 実行中ではない
 * npm run build / ping / node … その実行ファイルが子に居る → 実行中
 * ```
 *
 * ConPTY はシェルの中で何が起きているかを教えてくれないし、画面に流れた文字から
 * 「まだ終わっていないか」を当てにいくのは**プロンプトの見た目を推測すること**に
 * なる（利用者は好きにプロンプトを変えられる）。当てが外れたときに起きるのは
 * 「動いているものを黙って殺す」か「何も無いのに毎回尋ねる」のどちらかで、
 * どちらも確認を挟む目的から外れる。だから推測はせず、OS に聞く。
 *
 * 見るのは**直接の子だけ**で足りる ── `npm run build` の下で走る node も、
 * その下の tsc も、辿れば必ずシェルの直接の子を1つ経由する。
 * 孫が居て子が居ない形は作れないので、深さを追う理由が無い。
 *
 * ## 数えるのは「実行中かどうか」だけで、中身は持ち帰らない
 *
 * 返すのは「子を持っていた pid」までで、子の名前も pid も読み捨てる。
 * Renderer へ渡るのはさらにその先でセッションの id だけになる
 * （shared/terminal/session.ts の線をここでも引く）。「何が動いているか」を
 * 渡すと、次はそれを指して止める / 開く API を足したくなる。
 * 利用者に伝えたいのは**閉じると失われるものがある**という一点で、
 * その一点に名前は要らない。
 *
 * ## 分からないことがある
 *
 * PowerShell が見つからない・応答が返らない・出力が読めない、はどれも起こりうる。
 * その場合は `unknown` を返し、**判断は呼び出し側に委ねる**
 * （terminalSessions.ts は「生きているセッションを全部実行中と見なす」に倒す）。
 * ここで空配列を返してしまうと、分からなかったことが「何も動いていない」として
 * 伝わり、動いているビルドが黙って死ぬ。
 *
 * ## Electron に依存しない
 *
 * ログを出さず（結末に理由を載せて呼び出し側へ渡す）、`process.env` も引数で
 * 受け取る。この層の判断をテストで固定するためで、shellCommand.ts /
 * terminalEnvironment.ts と同じ分け方にあたる。
 *
 * ## v1 は Windows だけ
 *
 * 他の OS では `unknown` を返す。`ps` の呼び方は OS ごとに違い、v1 の対象は
 * Windows（DESIGN.md §8）になる。分岐をここに置いてあるのは、Mac 対応を
 * 始めるときに書き換える場所を1つに保つため。
 */

/**
 * 応答を待つ上限。
 *
 * 待っている間、利用者は「タブを閉じた / アプリを終了した」直後の無反応を見る。
 * 実測では 0.4 秒ほどで返るので、これは**返ってこない場合の逃げ道**にあたる
 * （返らなければ分からないまま＝尋ねる側に倒れる）。
 */
export const CHILD_PROCESS_QUERY_TIMEOUT_MS = 4000

/**
 * 問い合わせの結末。
 *
 * 「子を持っていなかった」と「分からなかった」を型で分ける。混ぜると、
 * 呼び出し側が**分からなかったものを安全な側へ倒せなくなる**。
 */
export type ChildProcessQueryOutcome =
  | { readonly status: 'known'; readonly pidsWithChildren: readonly number[] }
  | { readonly status: 'unknown'; readonly reason: string }

/**
 * WQL のフィルタを組み立てる（純粋）。
 *
 * 数として読めないものは落とす。ここへ来る pid は node-pty が返したものだけで
 * Renderer から届く値ではないが、**文字列としてコマンドの中へ入る**唯一の値なので、
 * 整数であることをこの関数の側で確かめる。1つも残らなければ null（聞く相手が無い）。
 */
export function buildChildProcessFilter(pids: readonly number[]): string | null {
  const usable = [...new Set(pids)].filter((pid) => Number.isSafeInteger(pid) && pid > 0)

  if (usable.length === 0) {
    return null
  }

  return usable.map((pid) => `ParentProcessId=${pid}`).join(' OR ')
}

/**
 * 問い合わせの出力から「子を持っていた親」を読む（純粋）。
 *
 * 1行に親の pid が1つ。同じ親が複数行に出る（子が2つ以上ある）ので畳み、
 * **聞いていない pid は落とす** ── 読み違えたものをそのまま「実行中」として
 * 見せないため。読めない行は黙って飛ばす（警告や空行が混ざりうる）。
 */
export function parseParentPids(stdout: string, requested: readonly number[]): readonly number[] {
  const asked = new Set(requested)
  const found = new Set<number>()

  for (const line of stdout.split(/\r?\n/)) {
    const value = Number.parseInt(line.trim(), 10)

    if (Number.isSafeInteger(value) && asked.has(value)) {
      found.add(value)
    }
  }

  return [...found]
}

/**
 * 渡した pid のうち、子プロセスを持っているものを調べる。
 *
 * **問い合わせは1回だけ**にしてある ── セッションの数だけ PowerShell を立てると、
 * 8本開いていれば8回分待つことになる。
 */
export async function queryPidsWithChildren(
  pids: readonly number[],
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>
): Promise<ChildProcessQueryOutcome> {
  const filter = buildChildProcessFilter(pids)

  // 聞く相手が居ない。OS を呼ぶまでもなく「どれも実行中ではない」。
  if (filter === null) {
    return { status: 'known', pidsWithChildren: [] }
  }

  if (platform !== 'win32') {
    return {
      status: 'unknown',
      reason: `looking for child processes is not implemented on ${platform}.`
    }
  }

  /*
    ここでも PATH には任せない（shellCommand.ts と同じ理由）。絶対パスにできなければ
    分からないままにする ── 名前だけに落とすと、作業ディレクトリの中身が
    起動されうる形を自分で作ることになる。
  */
  const powershell = resolveSystemPowerShell(env)

  if (powershell === null) {
    return { status: 'unknown', reason: 'could not locate PowerShell to ask the OS.' }
  }

  const command = `Get-CimInstance Win32_Process -Filter '${filter}' -Property ParentProcessId | ForEach-Object { $_.ParentProcessId }`

  return await new Promise<ChildProcessQueryOutcome>((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: CHILD_PROCESS_QUERY_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          resolve({ status: 'unknown', reason: `${error.name}: ${error.message}` })
          return
        }

        resolve({ status: 'known', pidsWithChildren: parseParentPids(stdout, pids) })
      }
    )
  })
}
