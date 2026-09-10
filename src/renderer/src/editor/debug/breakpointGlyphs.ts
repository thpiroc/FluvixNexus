import {
  isSameBreakpointGlyphDecorations,
  type BreakpointGlyphDecoration
} from './breakpointDecorations'

/**
 * glyph margin の印を Monaco へ当てる層（**Monaco を import しない**・テスト対象）。
 *
 * 受け取る型は構造的部分型にしてある（`editor/lsp/editorActions.ts` と同じ形）。
 * `monaco-editor` を値として import してよいのは monacoSetup.ts / MonacoEditor.tsx /
 * MonacoDiffEditor.tsx / markers.ts だけ、という既存の決め
 * （monaco/monacoSetup.ts の冒頭）を崩さないためで、副産物としてこのファイルは
 * 素のテストから試せる ── glyph margin を押す・印が増える / 減る・ファイルを
 * 切り替える、のどれも偽のエディタで通せる。
 *
 * ## 押した場所を確かめる
 *
 * Monaco の `onMouseDown` は**エディタのどこを押しても**届く。glyph margin の
 * 種別（`MouseTargetType.GUTTER_GLYPH_MARGIN`）と左ボタンを確かめないと、
 * 本文を選択しただけで印が付く。種別の値は Monaco の enum なので、
 * **持ち込むのは呼ぶ側**（MonacoEditor.tsx）になる。
 *
 * ## 印は「保存された行」に付く（v1 の制約）
 *
 * 正本は Main の側で、行番号は**利用者が印を置いた行**のまま動かない。一方
 * Monaco の decoration は編集に合わせて自分で動く ── 上に行を挿入すると、
 * 画面の印だけが下へずれ、正本とずれる。ずれたまま押すと**別の行に2つ目の印が
 * 付き、元の印は外せない**ことになる。
 *
 * そこで、行数が変わる編集のたびに**保存された行へ置き直す**。行の挿入に
 * 印が付いて回る挙動（VS Code はこちら）は v1 では入れない ── 付いて回らせるには
 * 編集のたびに正本を書き換える経路が要り、それは印の同期を Renderer 側の
 * 編集イベントに依存させることになる。**選択の裏返しとして受け入れる制約**にあたる
 * （docs/ARCHITECTURE.md §20.12）。
 */

/* ------------------------------------------------- Monaco の構造的部分型 */

export interface BreakpointGlyphDisposable {
  dispose: () => void
}

/** `monaco.editor.IModelDeltaDecoration` のうち、ここが組み立てるもの。 */
export interface BreakpointGlyphModelDecoration {
  readonly range: {
    readonly startLineNumber: number
    readonly startColumn: number
    readonly endLineNumber: number
    readonly endColumn: number
  }
  readonly options: {
    readonly glyphMarginClassName: string
    readonly glyphMarginHoverMessage: { readonly value: string }
  }
}

/** `monaco.editor.IEditorDecorationsCollection` のうち、ここが触るもの。 */
export interface BreakpointGlyphDecorationsCollection {
  set: (decorations: readonly BreakpointGlyphModelDecoration[]) => unknown
  clear: () => void
}

/** `monaco.editor.IEditorMouseEvent` のうち、ここが読むもの。 */
export interface BreakpointGlyphMouseEvent {
  readonly target: {
    readonly type: number
    readonly position: { readonly lineNumber: number } | null
  }
  readonly event: { readonly leftButton: boolean }
}

/** `monaco.editor.IModelContentChangedEvent` のうち、ここが読むもの。 */
export interface BreakpointGlyphContentChangedEvent {
  readonly changes: readonly {
    readonly range: { readonly startLineNumber: number; readonly endLineNumber: number }
    readonly text: string
  }[]
}

/**
 * 印を当てるのに要るぶんだけの Monaco エディタ。
 *
 * `monaco.editor.IStandaloneCodeEditor` はこの形を満たす。
 */
export interface BreakpointGlyphEditor {
  onMouseDown: (listener: (event: BreakpointGlyphMouseEvent) => void) => BreakpointGlyphDisposable
  onDidChangeModelContent: (
    listener: (event: BreakpointGlyphContentChangedEvent) => void
  ) => BreakpointGlyphDisposable
  /*
    引数が `readonly` でないのは、Monaco 側の宣言が可変配列を受けるため
    （`createDecorationsCollection(decorations?: IModelDeltaDecoration[])`）。
    構造的部分型として受けるので、こちらの宣言を狭くすると
    `IStandaloneCodeEditor` が「この形を満たさない」ことになる。
  */
  createDecorationsCollection: (
    decorations?: BreakpointGlyphModelDecoration[]
  ) => BreakpointGlyphDecorationsCollection
  getModel: () => { getLineCount: () => number } | null
}

/* -------------------------------------------------------------- 判断（純粋） */

/**
 * その click が「印の入れ替え」にあたるか。何行目かを返す（違えば null）。
 *
 * 左ボタン・glyph margin・行が取れること、の3つを揃って満たす場合だけ通す。
 */
export function resolveBreakpointToggleLine(
  event: BreakpointGlyphMouseEvent,
  glyphMarginTargetType: number
): number | null {
  if (!event.event.leftButton || event.target.type !== glyphMarginTargetType) {
    return null
  }

  const line = event.target.position?.lineNumber ?? null

  return line !== null && Number.isSafeInteger(line) && line > 0 ? line : null
}

/**
 * その編集で行数が変わるか。
 *
 * 変わらない編集（1行の中の打鍵）では decoration も動かないので、置き直さない
 * ── 打鍵1回ごとに Monaco の decoration を差し替える経路を作らないため。
 */
export function changesLineCount(event: BreakpointGlyphContentChangedEvent): boolean {
  return event.changes.some(
    (change) =>
      change.range.startLineNumber !== change.range.endLineNumber || change.text.includes('\n')
  )
}

/**
 * 印を Monaco の decoration にする。
 *
 * 行はモデルの範囲に収める（範囲外の行は落とす）。保存された印は**開いている
 * ファイルより長く生きる**ので、ファイルがアプリの外で短くなっていることは普通に起きる。
 */
export function toModelDecorations(
  decorations: readonly BreakpointGlyphDecoration[],
  lineCount: number,
  describe: (decoration: BreakpointGlyphDecoration) => string
): readonly BreakpointGlyphModelDecoration[] {
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
        glyphMarginClassName: decoration.className,
        glyphMarginHoverMessage: { value: describe(decoration) }
      }
    }))
}

/* ------------------------------------------------------------ 噛み合わせ */

export interface BreakpointGlyphControllerOptions {
  /** `monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN`（持ち込むのは呼ぶ側）。 */
  readonly glyphMarginTargetType: number
  /** glyph margin が押された。 */
  readonly onToggle: (line: number) => void
  /** hover に出す文言（翻訳は呼ぶ側が済ませる）。 */
  readonly describe: (decoration: BreakpointGlyphDecoration) => string
}

export interface BreakpointGlyphController {
  /** 出す印を差し替える。同じ内容なら Monaco に触れない。 */
  readonly render: (decorations: readonly BreakpointGlyphDecoration[]) => void
  /** 別のファイルへ移った（次の `render` は必ず当て直す）。 */
  readonly reset: () => void
  readonly dispose: () => void
}

/**
 * 1つのエディタに印の面を張る。
 *
 * 器（エディタ）が作り直されるたびに張り直す。Monaco の decoration も
 * mouse の購読もエディタに紐づくため、**器より長生きさせない**のが素直になる。
 */
export function createBreakpointGlyphController(
  editor: BreakpointGlyphEditor,
  options: BreakpointGlyphControllerOptions
): BreakpointGlyphController {
  const collection = editor.createDecorationsCollection([])
  let applied: readonly BreakpointGlyphDecoration[] | null = null

  function apply(decorations: readonly BreakpointGlyphDecoration[]): void {
    const model = editor.getModel()

    if (model === null) {
      collection.clear()
      applied = null
      return
    }

    collection.set(toModelDecorations(decorations, model.getLineCount(), options.describe))
    applied = decorations
  }

  const mouse = editor.onMouseDown((event) => {
    const line = resolveBreakpointToggleLine(event, options.glyphMarginTargetType)

    if (line !== null) {
      options.onToggle(line)
    }
  })

  /*
    行数が変わる編集の後は、保存された行へ置き直す（このファイルの冒頭）。
    `applied` を見て「今出している印」をそのまま当て直すので、
    正本を読み直す往復は起きない。
  */
  const content = editor.onDidChangeModelContent((event) => {
    if (applied !== null && changesLineCount(event)) {
      apply(applied)
    }
  })

  return {
    render: (decorations) => {
      if (applied !== null && isSameBreakpointGlyphDecorations(applied, decorations)) {
        return
      }

      apply(decorations)
    },
    reset: () => {
      collection.clear()
      applied = null
    },
    dispose: () => {
      mouse.dispose()
      content.dispose()
      collection.clear()
      applied = null
    }
  }
}
