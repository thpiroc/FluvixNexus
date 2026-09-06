import { resolveEditorLanguageId, type EditorLanguageId } from '../monaco/language'
import type { EditorDiagnosticMarker } from './diagnosticMarkers'

/**
 * 今どの文書にどの指摘が出ているか（Session 5-3・依存なし・テスト対象）。
 *
 * 診断は**片道のイベントとして届く**（誰も要求していないのに来る）ので、
 * 受け取った側に「今の状態」を持つ場所が要る。Monaco の marker は Model に
 * 付くが、Model の側からは読み出しづらく、まだ Model が無い瞬間もある。
 *
 * ```
 * useDiagnostics.ts   イベントを受け、ここへ入れ、Model へ流す
 * ここ                今の状態と、次に描き直すべき位置
 * markers.ts          Monaco の marker として実際に置く
 * ```
 *
 * Monaco を知らないので、届く順序と入れ替えの判断だけをそのまま試せる。
 *
 * ## 空の指摘と、控えが無いことを区別する
 *
 * ```
 * 控えがある（配列が空）… サーバが「この文書に問題は無い」と言った
 * 控えが無い            … サーバが答えていない（まだ・もう）
 * ```
 *
 * この違いが **Monaco 内蔵の指摘へ戻すかどうか**の判断になる
 * （`isServedByLsp`）。空の配列を「控えが無い」と同じに扱うと、
 * 問題が無いだけのファイルで内蔵の指摘が復活し、二重に出る。
 *
 * ## 古い指摘で新しい指摘を上書きしない
 *
 * Main も版を見て古いものを捨てている（main/lsp/diagnostics.ts）が、
 * ここでも**届いた順ではなく版の順**で入れ替える。イベントは片道で、
 * 「これが最後に送られたものだ」と言える手段が受け手側に他に無いため。
 *
 * ```
 * 版 7 を受け取る → 版 6 が届く（遅れて来た）→ 捨てる
 *                → 版 8 が届く              → 入れ替える
 *                → 版なしが届く             → 入れ替える（比べようが無い）
 * ```
 *
 * ## 描き直す位置を控える
 *
 * 入れ替えのたびに Monaco へ触らない。**変わった位置だけを控えておき**、
 * まとめて流す（`takeDirty`）── 診断はプロジェクトを開いた直後に
 * 何十通も連続して届くことがあり、そのたびに marker を置き直すと描画が詰まる。
 */

interface DiagnosticEntry {
  /** そのとき届いた版。サーバが言わなかった場合は null。 */
  readonly version: number | null
  readonly markers: readonly EditorDiagnosticMarker[]
}

export class EditorDiagnosticStore {
  private readonly entries = new Map<string, DiagnosticEntry>()

  /** 前回流してから変わった位置（消えたものを含む）。 */
  private readonly dirty = new Set<string>()

  /**
   * その文書の指摘を入れ替える。
   *
   * 戻り値は入れ替えたかどうか（古くて捨てた場合は false）。
   */
  set(
    relativePath: string,
    version: number | null,
    markers: readonly EditorDiagnosticMarker[]
  ): boolean {
    const existing = this.entries.get(relativePath)

    /*
      版が両方あって、届いたほうが古い。捨てる（上記）。
      同じ版は通す ── サーバが同じ版で計算し直して送ることがあり、
      そちらのほうが新しい答えになる。
    */
    if (
      existing !== undefined &&
      existing.version !== null &&
      version !== null &&
      version < existing.version
    ) {
      return false
    }

    this.entries.set(relativePath, { version, markers })
    this.dirty.add(relativePath)

    return true
  }

  /**
   * その文書の控えを外す（閉じた・サーバが答えられなくなった）。
   *
   * **空の配列を入れるのとは違う。** 外した文書は「サーバが答えていない」状態に
   * 戻り、Monaco 内蔵の指摘へ戻す判断の対象になる（このクラスの冒頭）。
   */
  clear(relativePath: string): boolean {
    if (!this.entries.delete(relativePath)) {
      return false
    }

    this.dirty.add(relativePath)

    return true
  }

  /** すべて外す（Workspace の切り替え・サーバの全停止）。 */
  clearAll(): void {
    for (const relativePath of this.entries.keys()) {
      this.dirty.add(relativePath)
    }

    this.entries.clear()
  }

  /** その文書の指摘。控えが無ければ null（空の配列とは違う）。 */
  get(relativePath: string): readonly EditorDiagnosticMarker[] | null {
    return this.entries.get(relativePath)?.markers ?? null
  }

  /** 控えのある位置。 */
  paths(): readonly string[] {
    return [...this.entries.keys()]
  }

  /**
   * 描き直すべき位置を取り出す（取り出したら控えは空になる）。
   *
   * 消えた位置も含まれる ── 受け取った側は `get` が null なら
   * marker を外す、という1つの流れで扱える。
   */
  takeDirty(): readonly string[] {
    const paths = [...this.dirty]

    this.dirty.clear()

    return paths
  }

  /**
   * その言語の指摘を、本物の Language Server が出しているか。
   *
   * **Monaco 内蔵の指摘を止めてよいかの判断がこれ**（renderer/src/editor/lsp/
   * useDiagnostics.ts）。1つでも控えがあれば、その言語はサーバが見ている。
   *
   * 言語ごとに見るのは、Monaco の内蔵診断の設定が**言語ごとに1つ**しか無いため
   * （`typescriptDefaults` / `javascriptDefaults` はアプリ全体に効く）。
   * 文書ごとに切り替える手段が Monaco の側に無い。
   */
  isServedByLsp(languageId: EditorLanguageId): boolean {
    for (const relativePath of this.entries.keys()) {
      if (resolveEditorLanguageId(relativePath) === languageId) {
        return true
      }
    }

    return false
  }
}
