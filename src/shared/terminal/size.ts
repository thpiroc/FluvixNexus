import {
  TERMINAL_MAX_COLUMNS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLUMNS,
  TERMINAL_MIN_ROWS,
  type TerminalSize
} from './session'

/**
 * ターミナルの大きさの正規化（Main / Renderer が同じ答えを見る必要がある純粋な判断）。
 *
 * shared に実装を置く数少ない例外の1つで、理由は fileName.ts と同じ
 * ── **同じ規則を2箇所に書くと、片方だけを通った値が生まれる。**
 * ここでは「Renderer が測った大きさ」と「Main が ConPTY へ渡す大きさ」が
 * 食い違うと、改行の位置が画面と実際でずれる（見えている行と、シェルが
 * 折り返している行が違う）という形で表に出る。
 *
 * ## 弾かずに丸める
 *
 * 他の入力（ファイル名・相対位置）は規則に合わなければ**断る**が、大きさは丸める。
 * 断るべき値と丸めるべき値の違いは、**利用者がその値を指したかどうか**にある。
 *
 *   ファイル名 … 利用者が打ったもの。勝手に直すと、指したものと違うものを触る
 *   大きさ     … 画面から測ったもの。利用者は 0 行を指していない
 *
 * パネルが畳まれている間・まだ描かれていない間・別のタブに隠れている間は
 * 0 が測られる。それを失敗として返すと、**畳んだだけでターミナルが壊れる。**
 *
 * ## それでも上限は要る
 *
 * 丸める先に上限を置くのは、この値が Renderer から来る＝境界の外から来るため。
 * 桁数と行数はそのまま ConPTY のバッファの大きさになるので、
 * 桁違いの値を素通しすると Main 側のメモリの話になる。
 *
 * 数として読めないもの（文字列・NaN・Infinity・欠けている）は丸めようが無いので
 * null を返す。呼び出し側（ipc/handlers/terminal.ts）はそれを不正な要求として扱う。
 */
export function normalizeTerminalSize(value: unknown): TerminalSize | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const { columns, rows } = value as { columns?: unknown; rows?: unknown }

  if (!Number.isFinite(columns) || !Number.isFinite(rows)) {
    return null
  }

  return {
    columns: clamp(Math.floor(columns as number), TERMINAL_MIN_COLUMNS, TERMINAL_MAX_COLUMNS),
    rows: clamp(Math.floor(rows as number), TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS)
  }
}

/** 大きさが同じか（無駄な resize を Main へ送らないために Renderer が使う）。 */
export function isSameTerminalSize(a: TerminalSize, b: TerminalSize): boolean {
  return a.columns === b.columns && a.rows === b.rows
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }

  return value > max ? max : value
}
