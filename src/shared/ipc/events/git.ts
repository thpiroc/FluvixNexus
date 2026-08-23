/**
 * git ドメインの Main → Renderer イベント（Session 3-8-8）。
 *
 * 要求と応答（contracts/git.ts）と対になる、**リポジトリの側から動く**通知。
 * Session 3-8-7 までの Git は要求と応答だけで足りていた ── 状態が変わる契機が
 * 「アプリの中の操作」か「作業ツリーのファイル変化」しか無かったため
 * （docs/ARCHITECTURE.md §14.5）。
 *
 * 内蔵 Terminal で `git add` / `git commit` / `git switch` を叩けるようになった
 * 時点で、その前提は崩れている ── そこで起きた変化は `.git` の中だけで完結し、
 * 作業ツリーのファイルは1つも動かないことがある（`git add` がまさにそれ）。
 * `.git` 専用の監視（main/git/gitWatcher.ts）が拾ったものをここへ流す。
 *
 * ## `files:changed` に相乗りさせない
 *
 * 同じ「変わった」でも運ぶものが違う。`files:changed` が運ぶのは
 * **どの位置がどうなったか**（WorkspaceFileChange）で、その形に
 * 「index が書き換わった」を当てはめられる relativePath は存在しない。
 * 無理に載せると、Files のツリーと Editor が `.git` の中の位置を
 * 受け取り始める（両者はこのイベントの主な受け手にあたる）。
 */

export interface GitChangedEvent {
  /**
   * どの Workspace のリポジトリで起きた変化か。
   *
   * `files:changed` と同じ理由で載せる ── 切り替えの前後で通知は行き違い、
   * イベントには「要求」という対応関係が無いため、受け手が自分で
   * 突き合わせるしか無い（shared/ipc/events/files.ts）。
   */
  readonly workspaceId: string
}

/**
 * git ドメインのイベント契約。
 *
 * **何が変わったかは載せない。** `.git` の中の位置は Renderer にとって
 * 意味を持たず、意味に翻訳できるのは git 自身だけになる。受け手がすることは
 * 常に1つ（`git:get-repository` を呼び直す）で、ブランチ名と変更一覧は
 * その1回の応答に揃って載る ── 半分だけ新しい画面を作らないための形が
 * そのまま、このイベントを「合図1つ」に留める理由にもなっている。
 */
export interface GitIpcEventContract {
  'git:changed': GitChangedEvent
}
