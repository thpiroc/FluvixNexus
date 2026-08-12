/**
 * Workspace レイアウトの永続化フォーマット。
 *
 * ここが「ディスクに置かれる JSON の形」の唯一の定義であり、
 * Renderer の実行時モデル（renderer/src/workspace/layout/types.ts の WorkspaceLayout）とは
 * **意図的に別の型**にしてある。理由は2つ。
 *
 *  1. 保存形式は後方互換を守る対象で、実行時モデルは自由に変えてよいものだから。
 *     同じ型を使い回すと、実行時モデルを1つ変えるたびに保存済みファイルが読めなくなる。
 *     2つに分けておけば、両者の差は「変換（マイグレーション）」として1箇所に現れる。
 *  2. 保存形式は id を branded type にせず、PanelId も string として持つ。
 *     アプリの更新でパネル構成が変わっても、まずは JSON として読めることを優先し、
 *     「知らない PanelId が入っていた」の判断は読み込み側の検証に任せる。
 *
 * shared 層のルールどおり、このファイルは型と定数だけを持つ（実装は置かない）。
 * Main はこの形のうち **エンベロープ（schemaVersion）しか見ない**。
 * layout の中身を解釈するのは Renderer 側だけであり、Main は「小さな JSON を1つ預かる」に徹する。
 */

/**
 * 保存データの構造バージョン。
 *
 * layout の形を変えたら必ずこの値を上げ、Renderer 側のマイグレーション表
 * （workspace/persistence/layoutDocument.ts）に「1つ前から今の形へ」の変換を足すこと。
 * 上げ忘れると、古い形のファイルを新しいコードがそのまま読もうとして壊れる。
 */
export const WORKSPACE_LAYOUT_SCHEMA_VERSION = 1

/**
 * 保存データの上限（おおよそのバイト数）。
 *
 * レイアウトは領域の木でしかなく、数 KB を超えることは通常あり得ない。
 * それでも上限を設けるのは、Renderer から届く値を Main がそのままディスクへ書くため。
 * 「Workspace レイアウト専用の API」という約束を、大きさの面からも担保する。
 */
export const WORKSPACE_LAYOUT_DOCUMENT_MAX_BYTES = 256 * 1024

/** 保存形式での split の向き。実行時モデルの SplitDirection と同じ語を使う。 */
export type StoredSplitDirection = 'row' | 'column'

/** 保存形式でのノード共通の性質。 */
interface StoredDockNodeBase {
  readonly id: string
  /** 親の並び方向における基準サイズ（px）。null は「残りを埋める」。 */
  readonly size: number | null
}

/** 保存形式での葉（パネルを置く領域）。 */
export interface StoredDockGroupNode extends StoredDockNodeBase {
  readonly kind: 'group'
  /** タブの並び順。値は PanelId だが、保存形式としては素の string で持つ。 */
  readonly panelIds: readonly string[]
  readonly activePanelId: string | null
}

/** 保存形式での枝（領域の分割）。 */
export interface StoredDockSplitNode extends StoredDockNodeBase {
  readonly kind: 'split'
  readonly direction: StoredSplitDirection
  /**
   * 子。実行時モデルと違い「2つ以上」を型で縛らない。
   * ファイルの中身は信用できないため、件数の検証は読み込み側で行う。
   */
  readonly children: readonly StoredDockNode[]
}

export type StoredDockNode = StoredDockGroupNode | StoredDockSplitNode

/**
 * schemaVersion 1 のレイアウト本体。
 *
 * 保存対象は「次の起動で同じ画面を組み立てるために必要なもの」だけ。
 * DockNode の木（配置・タブの並び・activePanelId・split の向き・size）と、
 * 適用中のレイアウトプリセットの識別子で足りる。
 * パネルが閉じているかどうかは木に居るかどうかで決まるため、別に持たない
 * （renderer/src/workspace/layout/panelVisibility.ts）。
 *
 * パネル本体の機能状態（開いているファイル、Terminal のセッションなど）はここでは扱わない。
 */
export interface StoredWorkspaceLayout {
  /** 適用中のレイアウトプリセット。閉じたパネルの戻り先を決めるのに要る。 */
  readonly presetId: string
  readonly root: StoredDockNode
}

/**
 * ディスクに置かれる文書そのもの。
 *
 * layout を unknown にしてあるのは、**古い schemaVersion のファイルもこの型で運ぶ**ため。
 * schemaVersion が 1 なら中身は StoredWorkspaceLayout だが、2 以降のファイルを
 * 古いアプリが読む場合や、1 より前の形を新しいアプリが読む場合はその限りではない。
 * 「この文書のバージョンは何か」だけを型として保証し、中身の形の保証は
 * マイグレーションを通した後に初めて成立する、という分け方にしている。
 */
export interface WorkspaceLayoutDocument {
  readonly schemaVersion: number
  readonly layout: unknown
}
