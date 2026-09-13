import type { DebugCallStackFrame, DebugCallStackSnapshot } from '@shared/debug'
import { findCurrentExecutionFrame } from '../../debug/executionLocation'
import { findCallStackFrame } from '../../debug/callStackSelection'
import type { TranslationKey } from '../../i18n/locales/types'

/**
 * 現在の実行位置を Monaco の decoration にする（Session 6-13。Monaco を import しない・テスト対象）。
 *
 * `breakpointDecorations.ts` と同じ立ち位置で、**決め方だけ**を持つ。実際に Monaco へ置くのは
 * executionLineGlyphs.ts。
 *
 * ## 印は2種類
 *
 * | 種類       | 何か                                                   | 見た目（editor.css）   |
 * | ---------- | ------------------------------------------------------ | ---------------------- |
 * | `current`  | 止まった thread の最上段 ── **実際に止まっている行**   | 暖色の帯 + 矢印        |
 * | `selected` | Call Stack で選んだ、最上段ではない frame              | 緑の帯 + 矢印          |
 *
 * 下の段を選んでいるときも `current` は消さない。消すと「選んだ行で止まっている」と読める。
 * 選んだ frame が最上段と同じファイルの同じ行なら `current` だけを出す（重ねない）。
 *
 * ## 色を1つも持たない / 文言ではなく翻訳キーを返す
 *
 * breakpoint の印と同じ理由（Theme / 言語の切り替えで取り残されない）。
 */

export type ExecutionLineKind = 'current' | 'selected'

export interface ExecutionLineDecoration {
  /** 1起点の行番号。 */
  readonly line: number
  readonly kind: ExecutionLineKind
  /** 行全体の帯に当てるクラス名。 */
  readonly lineClassName: string
  /** glyph margin に当てるクラス名（breakpoint の丸と同じ要素に並ぶ）。 */
  readonly glyphClassName: string
  /** hover に出す説明の翻訳キー。 */
  readonly messageKey: TranslationKey
}

const LINE_CLASS_NAMES: Readonly<Record<ExecutionLineKind, string>> = {
  current: 'fx-debug-execution-line fx-debug-execution-line--current',
  selected: 'fx-debug-execution-line fx-debug-execution-line--selected'
}

const GLYPH_CLASS_NAMES: Readonly<Record<ExecutionLineKind, string>> = {
  current: 'fx-debug-execution-glyph fx-debug-execution-glyph--current',
  selected: 'fx-debug-execution-glyph fx-debug-execution-glyph--selected'
}

const MESSAGE_KEYS: Readonly<Record<ExecutionLineKind, TranslationKey>> = {
  current: 'debug.executionLine.current',
  selected: 'debug.executionLine.selected'
}

/** そのファイル（相対位置）に出す印。止まっていなければ空。 */
export function toExecutionLineDecorations(
  snapshot: DebugCallStackSnapshot,
  selectedFrameId: number | null,
  relativePath: string
): readonly ExecutionLineDecoration[] {
  const current = findCurrentExecutionFrame(snapshot)

  if (current === null) {
    return []
  }

  const decorations: ExecutionLineDecoration[] = []
  const currentLine = lineIn(current, relativePath)

  if (currentLine !== null) {
    decorations.push(decoration(currentLine, 'current'))
  }

  if (selectedFrameId !== null && selectedFrameId !== current.id) {
    const selected = findCallStackFrame(snapshot, selectedFrameId)
    const selectedLine = selected === null ? null : lineIn(selected, relativePath)

    if (selectedLine !== null && selectedLine !== currentLine) {
      decorations.push(decoration(selectedLine, 'selected'))
    }
  }

  return decorations.sort((a, b) => a.line - b.line)
}

export function isSameExecutionLineDecorations(
  a: readonly ExecutionLineDecoration[],
  b: readonly ExecutionLineDecoration[]
): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index]

      return other !== undefined && item.line === other.line && item.kind === other.kind
    })
  )
}

/** その frame がこのファイルの行を指していれば行番号（Workspace 外 / 位置なしは null）。 */
function lineIn(frame: DebugCallStackFrame, relativePath: string): number | null {
  if (frame.source.kind !== 'workspace' || frame.source.relativePath !== relativePath) {
    return null
  }

  return frame.line
}

function decoration(line: number, kind: ExecutionLineKind): ExecutionLineDecoration {
  return {
    line,
    kind,
    lineClassName: LINE_CLASS_NAMES[kind],
    glyphClassName: GLYPH_CLASS_NAMES[kind],
    messageKey: MESSAGE_KEYS[kind]
  }
}
