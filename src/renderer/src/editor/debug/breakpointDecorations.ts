import { compareDebugBreakpoints, type DebugBreakpoint } from '@shared/debug'
import type { TranslationKey } from '../../i18n/locales/types'

/**
 * Breakpoint を glyph margin の印にする（Monaco を import しない・テスト対象）。
 *
 * `editor/lsp/diagnosticMarkers.ts` と同じ立ち位置で、**決め方だけ**を持つ。
 * 実際に Monaco へ置くのは editor/monaco/breakpointGlyphs.ts。
 *
 * ## 色を1つも持たない
 *
 * 返すのは**クラス名**だけで、16進数の色は1つも現れない。実際の色は
 * `theme.css` の変数から `editor.css` が引く ── Theme を切り替えたときに
 * 印だけ前の色で取り残されないための形で、Session 4-4 で決めた
 * 「このアプリの色は theme.css の1箇所にしかない」がそのまま効く。
 *
 * Monaco の `IModelDecorationOptions` には `color` を直に渡す欄もあるが、
 * **使わない**。使うと JavaScript の値として色を持つことになり、
 * Theme の切り替えのたびに decoration を置き直す処理が要る。
 *
 * ## 文言ではなく翻訳キーを返す
 *
 * hover に出す説明は、この層では**キーのまま**にする。文言にして持つと、
 * 印を置いたまま言語を切り替えたときに前の言語で取り残される
 * （workspaceFolder/context.ts の `error` と同じ理由）。言い表すのは描くとき。
 *
 * ## 印の位置は「利用者が押した行」
 *
 * adapter が別の行へ動かした場合の行（`adapterLine`）は、そもそも Renderer へ
 * 届かない（main/debug/breakpointModel.ts）。印を動かすと、もう一度押しても
 * 外せない位置に印が残ることになる。
 */

/** 印の見た目。`editor.css` の規則と1対1で対応する。 */
export type BreakpointGlyphKind = 'pending' | 'verified' | 'unverified' | 'disabled'

export interface BreakpointGlyphDecoration {
  /** 1起点の行番号。 */
  readonly line: number
  readonly kind: BreakpointGlyphKind
  /** glyph margin に当てるクラス名。 */
  readonly className: string
  /** hover に出す説明の翻訳キー。 */
  readonly messageKey: TranslationKey
}

const GLYPH_CLASS_NAMES: Readonly<Record<BreakpointGlyphKind, string>> = {
  pending: 'fx-breakpoint fx-breakpoint--pending',
  verified: 'fx-breakpoint fx-breakpoint--verified',
  unverified: 'fx-breakpoint fx-breakpoint--unverified',
  disabled: 'fx-breakpoint fx-breakpoint--disabled'
}

const GLYPH_MESSAGE_KEYS: Readonly<Record<BreakpointGlyphKind, TranslationKey>> = {
  pending: 'editor.breakpoint.pending',
  verified: 'editor.breakpoint.verified',
  unverified: 'editor.breakpoint.unverified',
  disabled: 'editor.breakpoint.disabled'
}

/**
 * その breakpoint をどう見せるか。
 *
 * ```
 * enabled === false … 無効（v1 の UI では起きないが、保存形式としてはありうる）
 * verified === null … Debug Session が無い / まだ答えが来ていない
 * verified === true … adapter が置けたと答えた
 * verified === false… adapter が置けないと答えた
 * ```
 *
 * **`null` を「置けない」と同じ見た目にしない。** 走らせる前はいつも null で、
 * そこを失敗の色にすると、始める前から間違っているように見える。
 */
export function toBreakpointGlyphKind(breakpoint: DebugBreakpoint): BreakpointGlyphKind {
  if (!breakpoint.enabled) {
    return 'disabled'
  }

  if (breakpoint.verified === null) {
    return 'pending'
  }

  return breakpoint.verified ? 'verified' : 'unverified'
}

/** その相対位置のぶんだけを、行の昇順で印にする。 */
export function toBreakpointGlyphDecorations(
  breakpoints: readonly DebugBreakpoint[],
  relativePath: string
): readonly BreakpointGlyphDecoration[] {
  return breakpoints
    .filter((breakpoint) => breakpoint.relativePath === relativePath)
    .slice()
    .sort(compareDebugBreakpoints)
    .map((breakpoint) => {
      const kind = toBreakpointGlyphKind(breakpoint)

      return {
        line: breakpoint.line,
        kind,
        className: GLYPH_CLASS_NAMES[kind],
        messageKey: GLYPH_MESSAGE_KEYS[kind]
      }
    })
}

/**
 * 置き直す必要があるか。
 *
 * 通知は**全件が毎回届く**（shared/ipc/events/debug.ts）ので、そのまま当てると
 * 1文字打つたびに関係の無いファイルの印まで置き直すことになる。
 * 同じ内容なら Monaco に触れない、という判断をここに置く
 * （`setBuiltInValidationSuppressed` が同じ値なら何もしないのと同じ形）。
 */
export function isSameBreakpointGlyphDecorations(
  a: readonly BreakpointGlyphDecoration[],
  b: readonly BreakpointGlyphDecoration[]
): boolean {
  return (
    a.length === b.length &&
    a.every((decoration, index) => {
      const other = b[index]

      return other !== undefined && decoration.line === other.line && decoration.kind === other.kind
    })
  )
}
