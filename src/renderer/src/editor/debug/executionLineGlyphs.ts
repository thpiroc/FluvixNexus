import {
  isSameExecutionLineDecorations,
  type ExecutionLineDecoration
} from './executionLineDecorations'

/**
 * 現在の実行位置を Monaco へ当てる層（Session 6-13。**Monaco を import しない**・テスト対象）。
 *
 * breakpointGlyphs.ts と同じく構造的部分型で受ける。違うのは2点:
 *
 * - **押されても何もしない。** 印を置く操作は breakpoint の側にしかない（mouse を購読しない）
 * - **編集で置き直さない。** breakpoint は「保存された行」が正本なので置き直すが、実行位置は
 *   Monaco の decoration が編集に付いて動くほうが素直（止まっている文そのものに付いて回る）。
 *   次の停止で Main から新しい位置が届けば、そこで当て直される
 *
 * breakpoint とは**別の decorations collection** を持つ。同じ collection にすると、
 * breakpoint の差し替えのたびに実行位置も消えて当て直され、逆もまた起きる。
 */

export interface ExecutionLineModelDecoration {
  readonly range: {
    readonly startLineNumber: number
    readonly startColumn: number
    readonly endLineNumber: number
    readonly endColumn: number
  }
  readonly options: {
    readonly isWholeLine: boolean
    readonly className: string
    readonly glyphMarginClassName: string
    readonly glyphMarginHoverMessage: { readonly value: string }
  }
}

export interface ExecutionLineDecorationsCollection {
  set: (decorations: readonly ExecutionLineModelDecoration[]) => unknown
  clear: () => void
}

/** `monaco.editor.IStandaloneCodeEditor` はこの形を満たす。 */
export interface ExecutionLineEditor {
  /* 引数が `readonly` でない理由は breakpointGlyphs.ts の同じ宣言と同じ。 */
  createDecorationsCollection: (
    decorations?: ExecutionLineModelDecoration[]
  ) => ExecutionLineDecorationsCollection
  getModel: () => { getLineCount: () => number } | null
}

/** 行はモデルの範囲に収める（ファイルがアプリの外で短くなっていることがある）。 */
export function toExecutionLineModelDecorations(
  decorations: readonly ExecutionLineDecoration[],
  lineCount: number,
  describe: (decoration: ExecutionLineDecoration) => string
): readonly ExecutionLineModelDecoration[] {
  return decorations
    .filter((decoration) => decoration.line <= lineCount)
    .map((decoration) => ({
      range: {
        startLineNumber: decoration.line,
        startColumn: 1,
        endLineNumber: decoration.line,
        endColumn: 1
      },
      options: {
        isWholeLine: true,
        className: decoration.lineClassName,
        glyphMarginClassName: decoration.glyphClassName,
        glyphMarginHoverMessage: { value: describe(decoration) }
      }
    }))
}

export interface ExecutionLineController {
  /** 出す印を差し替える。同じ内容なら Monaco に触れない。空なら消す。 */
  readonly render: (decorations: readonly ExecutionLineDecoration[]) => void
  /** 別のファイルへ移った / 言語が変わった（次の `render` は必ず当て直す）。 */
  readonly reset: () => void
  readonly dispose: () => void
}

export function createExecutionLineController(
  editor: ExecutionLineEditor,
  describe: (decoration: ExecutionLineDecoration) => string
): ExecutionLineController {
  const collection = editor.createDecorationsCollection([])
  let applied: readonly ExecutionLineDecoration[] | null = null

  return {
    render: (decorations) => {
      if (applied !== null && isSameExecutionLineDecorations(applied, decorations)) {
        return
      }

      const model = editor.getModel()

      if (model === null || decorations.length === 0) {
        collection.clear()
        applied = model === null ? null : decorations
        return
      }

      collection.set(toExecutionLineModelDecorations(decorations, model.getLineCount(), describe))
      applied = decorations
    },
    reset: () => {
      collection.clear()
      applied = null
    },
    dispose: () => {
      collection.clear()
      applied = null
    }
  }
}
