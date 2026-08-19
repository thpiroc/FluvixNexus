/**
 * Files パネルの表示方式（ツリー / カラム）の決め方（React にも DOM にも依存しない。Session 3-6-7）。
 *
 * DESIGN.md §3「Files パネルの表示切り替え」── 縦長ならツリー、横長ならカラム。
 * ただし**パネルの形は利用者がいつでも変えられる**（Dock / Split / Resize）ので、
 * 「形から決まる方」と「利用者が選んだ方」を1つの値に混ぜない。
 *
 * ## 提案（auto）と選択（explicit）を分ける
 *
 * 混ぜると、リサイズのたびに利用者の選択が上書きされる。カラムで見たいから
 * カラムにしたのに、パネルを少し細くした拍子にツリーへ戻り、戻すとまた次の
 * リサイズで変わる ── **選んだことが残らない**状態になる。
 *
 *   auto     … パネルの形に任せる（起動直後。まだ何も選んでいない）
 *   explicit … 利用者が選んだ。以降、形が変わってもこちらが勝つ
 *
 * 「勝手に変わらない」ことと「置いた場所に合う形で出る」ことは両立できる。
 * 分けてあるのはそのためで、選び直す手段（ツールバーのボタン）は常に出ている。
 *
 * ## しきい値には遊びを持たせる（ヒステリシス）
 *
 * 切り替わる幅と戻る幅を同じ値にすると、境界の付近でパネルを掴んで動かしている間、
 * 1px 動かすたびに表示方式が入れ替わる。**入る条件を厳しく、出る条件を緩く**して、
 * 境界の上での往復が起きないようにしてある。
 *
 * 提案が変わったときだけ状態を書き換える（useFilesLayout.ts）ので、
 * リサイズ中に走る React の更新はこの入れ替わりの回数だけになる。
 */

/** Files パネルの中身の並べ方。 */
export type FilesLayoutMode = 'tree' | 'columns'

/**
 * 今の表示方式が何によって決まっているか。
 *
 * `auto` は「まだ選んでいない」であって「自動に固定した」ではない。
 * 利用者が選べば explicit へ移り、以後リサイズでは変わらない。
 */
export type FilesLayoutPreference =
  { readonly kind: 'auto' } | { readonly kind: 'explicit'; readonly mode: FilesLayoutMode }

/** 起動直後（まだ選んでいない）。 */
export const AUTO_LAYOUT_PREFERENCE: FilesLayoutPreference = { kind: 'auto' }

/** 何も測れていない間の既定。細いパネルでも成立するツリーから始める。 */
export const DEFAULT_LAYOUT_MODE: FilesLayoutMode = 'tree'

/* -------------------------------------------------------- カラムの幅（Session 3-6-8） */

/**
 * カラム1枚の幅（px）の既定。
 *
 * Session 3-6-7 ではこの値で固定していた。掴んで変えられるようにした後も
 * **中身に合わせて伸ばすことはしない** ── 深い階層へ入るたびに左のカラムの幅が変わり、
 * さっき押した行の位置が動く。変えるのは利用者だけになる。
 */
export const DEFAULT_FILES_COLUMN_WIDTH = 208

/**
 * カラムの幅の下限（px）。
 *
 * アイコン（14px）＋ 短い名前 ＋「この先がある」印が並ぶ幅。これより狭くすると、
 * どの行も省略記号だけになって列としての用を成さない。
 */
export const FILES_COLUMN_WIDTH_MIN = 160

/**
 * カラムの幅の上限（px）。
 *
 * カラム表示を勧める幅（520px）でも2枚は並ぶ範囲に留める。上限が無いと、
 * 1枚で埋め尽くして**カラム表示なのに1階層しか見えない**状態を保存できてしまう。
 */
export const FILES_COLUMN_WIDTH_MAX = 480

/** 観測したパネルの大きさ（px）。 */
export interface FilesPanelSize {
  readonly width: number
  readonly height: number
}

/**
 * カラムを勧め始める幅（px）。
 *
 * カラム2枚（約 200px ずつ）とスクロールの余地が収まる幅。これより狭いと、
 * 横に並べた時点でどちらのカラムも名前が読めない幅になる。
 */
const COLUMNS_ENTER_WIDTH = 520

/** ツリーへ戻す幅（px）。上より狭くしてあるのが遊びにあたる。 */
const COLUMNS_EXIT_WIDTH = 440

/** カラムを勧め始める縦横比。横が縦の 1.6 倍以上になったら「横長」とみなす。 */
const COLUMNS_ENTER_ASPECT = 1.6

/** ツリーへ戻す縦横比。上より小さくしてあるのが遊びにあたる。 */
const COLUMNS_EXIT_ASPECT = 1.2

/**
 * 今のパネルの形が勧める表示方式。
 *
 * 今の提案（`current`）を受け取るのは、しきい値の遊びを効かせるため
 * ── 同じ大きさでも「今どちらにいるか」で答えが変わる区間がある。
 *
 * 大きさが測れない間（幅か高さが 0。パネルを閉じている・まだ描かれていない）は
 * 今の提案を据え置く。0 を「とても細い」と読むと、隠れている間に勝手にツリーへ
 * 戻ることになる。
 */
export function suggestLayoutMode(
  current: FilesLayoutMode,
  { width, height }: FilesPanelSize
): FilesLayoutMode {
  if (width <= 0 || height <= 0) {
    return current
  }

  const aspect = width / height

  if (current === 'tree') {
    return width >= COLUMNS_ENTER_WIDTH && aspect >= COLUMNS_ENTER_ASPECT ? 'columns' : 'tree'
  }

  return width < COLUMNS_EXIT_WIDTH || aspect < COLUMNS_EXIT_ASPECT ? 'tree' : 'columns'
}

/**
 * 実際に出す表示方式。
 *
 * 選んでいればそれ、選んでいなければパネルの形の提案。**この1本だけが
 * 「今どちらを描くか」を答える** ── 表示側が preference と提案の両方を見て
 * 判断する形にすると、判断が画面のあちこちに散る。
 */
export function resolveLayoutMode(
  preference: FilesLayoutPreference,
  suggestion: FilesLayoutMode
): FilesLayoutMode {
  return preference.kind === 'explicit' ? preference.mode : suggestion
}

/**
 * その表示方式を選んだときの preference。
 *
 * **提案と同じ方を選んでも explicit にする。** 「今たまたま同じ」と
 * 「これがいい」は別のことで、同じ扱いにすると、パネルを横長にした瞬間に
 * ツリーを選んだはずの利用者の画面がカラムへ変わる。
 */
export function chooseLayoutMode(mode: FilesLayoutMode): FilesLayoutPreference {
  return { kind: 'explicit', mode }
}
