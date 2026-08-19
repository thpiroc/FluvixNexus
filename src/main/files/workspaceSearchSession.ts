import type { WorkspaceSearchCancellation } from './searchWorkspaceFiles'

/**
 * 今走っている検索の管理（Session 3-6-4）。
 *
 * 走査そのもの（searchWorkspaceFiles.ts）は「止めてよいか」を訊きに来るだけで、
 * **誰が止めたのかを知らない。** 止める理由を集めているのがこのファイルになる。
 *
 *   新しい検索が来た … 古い検索は即座に止める（beginWorkspaceSearch）
 *   利用者が止めた   … `files:cancel-search`（cancelWorkspaceSearch）
 *   Workspace が変わった / 閉じた … 進行中のものを捨てる（cancelWorkspaceSearches）
 *
 * fs にも Electron にも触れないため、そのままテストできる
 * （Workspace の切り替えに気づくのは ipc/handlers/files.ts の仕事で、
 * この層は「捨てろ」と言われたことしか知らない）。
 *
 * ## 同時に走るのは常に1つ
 *
 * 検索は Workspace 全体を舐める操作で、同時に何本も走らせる意味が無い
 * （利用者が見ている検索欄は1つで、古い結果はもう要らない）。
 * 上限（件数・走査数・時間）も「1本ぶん」として決めてあるため、
 * 並行して走れる形にすると、その上限が実質的に本数ぶん緩む。
 *
 * 打ち切りではなく**置き換え**にしてあるのが要点で、文字を1つ打つたびに
 * 新しい検索が始まる UI（renderer/src/files/useFileSearch.ts）でも、
 * ディスクを舐めているのは常に最後の1本だけになる。
 *
 * ## 取り消しは失敗ではない
 *
 * 止められた検索は `'cancelled'` として**正常に**返る（shared/files/search.ts）。
 * 途中まで見つけたものも一緒に返るため、利用者が自分で止めた場合は
 * その時点の結果がそのまま残る。
 */

/** 今走っている検索1本ぶんの記録。 */
interface ActiveSearch {
  readonly searchId: string
  readonly workspaceId: string
  /** 止められたか。走査側が見るのはこの値そのもの。 */
  cancelled: boolean
}

/**
 * 走っている検索を呼び出し側へ渡す形。
 *
 * `cancellation` を走査へ渡し、終わったら `finish()` を呼ぶ（成功でも失敗でも）。
 * 呼び忘れても次の検索が始まった時点で置き換わるが、そのときまで
 * 「走っていない検索が走っていることになっている」状態が残る。
 */
export interface WorkspaceSearchHandle {
  readonly searchId: string
  readonly workspaceId: string
  /** 走査が見に来る窓口（searchWorkspaceFiles.ts）。 */
  readonly cancellation: WorkspaceSearchCancellation
  /** 走査が終わったことを伝える。まだ現役ならこの検索を片付ける。 */
  readonly finish: () => void
}

let active: ActiveSearch | null = null

/**
 * 新しい検索を始める。
 *
 * **古い検索は必ず止まる。** 呼び出し側が判断する余地を残していないのは、
 * 「置き換えるつもりで走らせっぱなしにする」経路を作らないため。
 */
export function beginWorkspaceSearch(workspaceId: string, searchId: string): WorkspaceSearchHandle {
  cancelWorkspaceSearches()

  const search: ActiveSearch = { workspaceId, searchId, cancelled: false }

  active = search

  return {
    searchId,
    workspaceId,
    cancellation: {
      get cancelled(): boolean {
        return search.cancelled
      }
    },
    finish: (): void => {
      // 既に別の検索へ置き換わっていれば、片付ける相手はもう自分ではない。
      if (active === search) {
        active = null
      }
    }
  }
}

/**
 * その識別子の検索を止める。実際に走っていた場合だけ true。
 *
 * **識別子が違えば何もしない。** 利用者が止める操作と、新しい検索が始まる操作は
 * 前後しうる（止めるボタンを押した瞬間に次の文字を打つ）ため、
 * 識別子を見ずに「今の検索」を止めると、始まったばかりの検索が消える。
 */
export function cancelWorkspaceSearch(searchId: string): boolean {
  if (active === null || active.searchId !== searchId) {
    return false
  }

  return cancelWorkspaceSearches()
}

/**
 * 走っている検索を捨てる（Workspace の切り替え / Close、アプリの終了）。
 *
 * 切り替えの後に前の Workspace の結果が届いても Renderer は捨てるが、
 * **捨てられる結果のためにディスクを舐め続けない。**
 */
export function cancelWorkspaceSearches(): boolean {
  if (active === null) {
    return false
  }

  active.cancelled = true
  active = null

  return true
}

/** 今走っている検索の識別子（走っていなければ null）。 */
export function getActiveWorkspaceSearchId(): string | null {
  return active?.searchId ?? null
}
