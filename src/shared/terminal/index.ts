/**
 * Terminal 契約レイヤーの公開窓口。
 *
 * Main / Preload / Renderer はこのモジュール経由で Terminal の型と定数を参照する。
 * shared 層のルールどおり、ここに実装は置かない
 * （例外は size.ts の正規化。Main と Renderer が同じ答えを見る必要がある
 * 純粋な数の判断で、理由はそのファイルの冒頭にある）。
 */
export {
  TERMINAL_INPUT_MAX_LENGTH,
  TERMINAL_MAX_COLUMNS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MAX_SESSIONS,
  TERMINAL_MIN_COLUMNS,
  TERMINAL_MIN_ROWS
} from './session'

export type { TerminalSession, TerminalSize } from './session'

export { isTerminalShellId, TERMINAL_DEFAULT_SHELL_ID, TERMINAL_SHELL_IDS } from './shell'

export type { TerminalShellChoice, TerminalShellId } from './shell'

export { isSameTerminalSize, normalizeTerminalSize } from './size'
