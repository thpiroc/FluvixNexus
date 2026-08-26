import type { GitDiffUnavailableReason } from './diff'
import type { GitCommitSummary } from './history'
import type { GitChangeKind } from './status'

/**
 * commit 1件の中身（Session 3-8-12）。
 *
 * ## history.ts との分担
 *
 * history.ts が持つのは**連なり**（100 件の行）で、こちらが持つのは
 * その中の**1件を開いたときに出るもの**になる。分けてあるのは、
 * 見られている時間が違うため ── 一覧は履歴を開いている間ずっと出ていて、
 * 詳細は1行を選んだその間だけになる。相乗りさせると、`git log` の1回で
 * 100 件ぶんの変更ファイルまで読むことになり、誰も開かない 99 件の
 * ファイル名を IPC の向こうへ運ぶ形になる。
 *
 * ## rev は「短い hash」のまま
 *
 * 3-8-11 で `GitCommitSummary` に載せたのは短い hash（`%h`）だけで、
 * 完全な hash は載せていない。3-8-12 でもそこは変えない ── 詳細を求める
 * ときに渡るのも短い hash で、Main がその1つを git に解かせる
 * （main/git/gitCommitHash.ts が形を確かめ、main/git/gitCommands.ts が
 * `--end-of-options` の後ろに置く）。
 *
 * 完全な hash を載せると「40 桁を渡せる欄」が増えるだけで、**解けなかった
 * ときの答えは同じ**（`not-found`）になる。桁数を決めるのは git の側で、
 * アプリが長い方を持ち回る理由がここには無い。
 *
 * ## マージ commit は対象外（Session 3-8-12）
 *
 * 親が2つ以上ある commit では、**どちらの親と比べるか**が決まらない。
 * git 自身も既定では答えを出さず（`git diff-tree <merge>` は何も出力しない）、
 * 出させるには「1つめの親と比べる」「全部の親と比べた合成」のどちらかを
 * こちらが選ぶことになる ── どちらを選んでも、画面に出た一覧が
 * 「この commit で変わったもの」とは違う意味を持つ。
 *
 * したがって `merge` は**失敗ではなく、答えの1つ**として返す
 * （画面はその理由をそのまま出す。renderer/src/git/gitCommitDetail.ts）。
 *
 * shared 層のルールどおり、このファイルは型と定数だけを持つ。
 */

/**
 * commit の中で1つのファイルに起きたこと。
 *
 * `GitChangeKind` から2つを除いた集合になる。
 *
 *   `untracked`  … commit の中に「まだ Git が知らないもの」は在りえない
 *   `conflicted` … 衝突は作業ツリーの状態で、記録された commit には残らない
 *
 * **新しい語を作らず、既にある語から引く**形にしてあるのは、画面の側が
 * 同じ記号と同じ読み上げ名を使えるようにするため（`describeGitChangeKind`）──
 * 変更ファイルの一覧と commit の詳細で、同じ `M` が別の名前で出ることを避ける。
 */
export type GitCommitChangeKind = Exclude<GitChangeKind, 'untracked' | 'conflicted'>

/**
 * commit の中で変わったファイル1件。
 *
 * `GitFileChange`（status.ts）と別の型にしてある ── あちらは
 * **今の作業ツリーと index** の1行で、`directory`（未追跡のフォルダが
 * 1件にまとまる）という作業ツリー固有の欄を持つ。commit の中の tree には
 * その畳み方が無く、常に1件＝1ファイルになる。
 */
export interface GitCommitFileChange {
  /**
   * リポジトリ root からの相対位置（区切りは `/`）。
   *
   * rename / copy では**変更後**の位置が入る（`GitFileChange` と同じ向き）。
   */
  readonly relativePath: string
  readonly kind: GitCommitChangeKind
  /** rename / copy の元の位置。それ以外は null。 */
  readonly originalPath: string | null
}

/**
 * 1件の commit で出す変更ファイルの上限。
 *
 * 履歴の 100 件（`GIT_COMMIT_HISTORY_LIMIT`）と同じ理由で置いている ──
 * commit 1件に含まれるファイル数には上限が無く、初回 commit や
 * 大きな取り込みでは数万件になる。IPC を1回で渡す形（3-8-11 と同じ）を
 * 保つには、どこかで切る必要がある。
 *
 * 500 にしてあるのは、履歴の 100 件より**明らかに多い**必要があるため ──
 * 普段の commit は数件から数十件で、100 件で切ると「大きめの1回」が
 * 頻繁に切られることになる。一方で 500 件を超える commit を縦に読む人は
 * 居らず、そこから先は Terminal パネルの `git show --stat` の領分になる。
 *
 * 超えた分は**黙って捨てない。** 切れていることを `truncated` として返し、
 * 画面にもそう出す（履歴・ブランチの一覧と同じ形）。
 */
export const GIT_COMMIT_FILE_LIMIT = 500

/** 詳細を出せなかった理由。 */
export type GitCommitDetailUnavailableReason =
  /**
   * もう調べられる状態ではない。
   *
   * Workspace が閉じられた・リポジトリでなくなった・root が食い違うように
   * なった（`GitDiffUnavailableReason` の同名と同じ意味）。
   */
  | 'not-ready'
  /**
   * その commit が見つからなかった。
   *
   * 開いてから取りに行くまでの間に消えた（端末での `reset` の後に GC された）・
   * 短い hash が別の object にも当たるようになった（曖昧）、が当たる。
   * どちらも利用者の次の一手は同じ（履歴を開き直す）になる。
   */
  | 'not-found'
  /**
   * マージ commit だった（上記）。
   *
   * **失敗ではない。** git が答えを持たないのではなく、
   * 「どちらの親と比べるか」をアプリが決めないという判断になる。
   */
  | 'merge'
  /** 上記のいずれにも当てはまらない（git が動かなかった・出力が読めなかった）。 */
  | 'failed'

/**
 * commit 1件の詳細を尋ねた結果。
 *
 * 履歴（`GitCommitHistory`）と同じく、**読めなかったことを `IpcResult` の
 * 失敗にしない** ── 開いた面の中に理由を出せばよいもので、汎用のエラー文言に
 * 丸めると利用者はその面のどこを見ればよいかを失う（shared/git/repository.ts）。
 *
 * `commit` を応答に載せているのは、**画面が持っている行を信じないため**になる。
 * Renderer は履歴の行（`GitCommitSummary`）を既に持っているが、それは
 * 開いた時点の写しにあたる ── 出す見出しは、詳細を読んだのと同じ1回の中で
 * git が答えたものにする（Stage / Unstage の応答に操作後の状態を載せているのと
 * 同じ形。shared/ipc/contracts/git.ts）。
 */
export type GitCommitDetail =
  | {
      readonly status: 'ready'
      /** 開いた commit そのもの（見出しに出す）。 */
      readonly commit: GitCommitSummary
      /** git が返した順（`diff-tree` の出力順 ＝ path 順）。 */
      readonly files: readonly GitCommitFileChange[]
      /** 上限（`GIT_COMMIT_FILE_LIMIT`）で切ったか。 */
      readonly truncated: boolean
    }
  | { readonly status: 'unavailable'; readonly reason: GitCommitDetailUnavailableReason }

/**
 * commit の中の1ファイルの差分。
 *
 * ## `GitFileDiff`（diff.ts）と別の型にしてある
 *
 * あちらは `group`（staged / unstaged / untracked）を持つ ── 「今の作業ツリーの
 * どの段を見ているか」で、記録された commit には当てはまらない。commit の差分で
 * 比べる相手は常に1組（親の tree と、この commit の tree）で、選ぶ余地が無い。
 *
 * `group` を optional にして1つの型に畳まないのは、**畳んだ日から「group が
 * 無い差分」を画面側が毎回確かめることになる**ため。欄の名前と中身は
 * `GitFileDiff` と揃えてあるので、面の側は中身を出す部分を分けずに済む
 * （renderer/src/git/GitDiffOverlay.tsx）。
 *
 * 出せなかった理由は**同じ表を使う**（`GitDiffUnavailableReason`）── バイナリ・
 * 大きすぎ・見つからない、はどちらの差分でも同じことが起き、同じ言葉で足りる。
 */
export type GitCommitFileDiff =
  | {
      readonly status: 'ready'
      /** どのファイルか（要求した位置がそのまま返る）。 */
      readonly relativePath: string
      /** rename / copy の元の位置。それ以外は null。 */
      readonly originalPath: string | null
      readonly kind: GitCommitChangeKind
      /** 左に出す中身（親の tree の側）。追加では空文字になる。 */
      readonly original: string
      /** 右に出す中身（この commit の tree の側）。削除では空文字になる。 */
      readonly modified: string
    }
  | { readonly status: 'unavailable'; readonly reason: GitDiffUnavailableReason }
