import { statSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emitIpcEvent } from '../ipc/events'
import { createLogger } from '../logger'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../workspaceFolder/currentWorkspaceFolder'
import { nextGitChangeDelayMs } from './gitChangeSchedule'
import { GIT_DIRECTORY_NAME, isMeaningfulGitChange, toGitWatchPath } from './gitWatchPaths'

/**
 * `.git` を見張り、リポジトリの状態が変わったことを Renderer へ伝える
 * （Session 3-8-8）。
 *
 * ## `files:changed` に混ぜない
 *
 * 作業ツリーの監視（main/files/workspaceWatcher.ts）とは**別の watcher**で、
 * 流すイベントも別（`git:changed`）にしてある。混ぜない理由は3つある。
 *
 *   1. 見る場所が逆 ── `files:changed` は `.git` を**除外することで**成り立って
 *      いる（main/files/ignoredDirectories.ts）。同じ経路に載せるには、その除外に
 *      穴を開けることになり、Files のツリーと Editor が `.git` の中の変化を
 *      受け取り始める
 *   2. 運ぶものが違う ── `files:changed` は「どの位置がどうなったか」を運ぶが、
 *      `.git/index` が書き換わったことに対応する relativePath は存在しない
 *   3. 桁が違う ── 1回の `git commit` で `.git` の中には数百件の書き込みが起き、
 *      その大半は `objects/`。同じ束に入れると、Files 側の上限
 *      （MAX_CHANGES_PER_BATCH）をこの watcher が食い潰す
 *
 * ```
 * fs.watch（.git 1つ・再帰）
 *    ↓  .git からの相対位置
 * gitWatchPaths.ts     許可した名前だけを通す（.lock と objects/ は捨てる）
 *    ↓
 * gitChangeSchedule.ts いつ配るかを決める（束ねる・遅れすぎない・暴れない）
 *    ↓
 * emitIpcEvent('git:changed', { workspaceId })
 * ```
 *
 * ## 運ぶのは `workspaceId` だけ
 *
 * 「何が変わったか」は載せない。`.git` の中の位置は Renderer にとって
 * 意味を持たず、意味に翻訳できるのは git 自身だけになる ── 受け手がすることは
 * 常に1つ（`git:get-repository` を呼び直す）で、ブランチ名と変更一覧は
 * その1回の応答に揃って載る（§14.5）。
 *
 * ## 読み取りが自分を呼び戻さないこと
 *
 * `.git/index` を見張るということは、**アプリ自身の `git status` が index を
 * 書き換えたらそこで無限に回る**ということでもある。回らないのは、読み取りに
 * `--no-optional-locks` と `GIT_OPTIONAL_LOCKS=0` を掛けてあるため
 * （main/git/gitCommands.ts / gitEnvironment.ts）── この2つが効いている間、
 * `git status` は index を読み直しても**書き戻さない**。
 *
 * 書き込む操作（Stage / Commit / 切り替え）はもちろん index を書くので、
 * 応答で状態を返した後に `git:changed` が1回届く。それは読み直し1回で終わる
 * ── 読み直しが次の変化を生まないため。
 *
 * ## `.git` がまだ無い Workspace
 *
 * `git init` するまで見張る先が無い。そこだけ**Workspace root を浅く**（再帰なし）
 * 見張り、`.git` が現れたら本来の監視へ切り替える。root を再帰で見張らないのは、
 * それが `files:changed` の担当そのものだから ── 同じ木を2本の再帰監視で
 * 見張ると、Windows の ReadDirectoryChangesW のバッファを二重に使うことになる。
 */

const log = createLogger('git-watcher')

/**
 * 監視の張り先。
 *
 * | 値                | いつ                                            |
 * | ----------------- | ----------------------------------------------- |
 * | `git-directory`   | `.git` がある（通常）                           |
 * | `workspace-root`  | `.git` がまだ無い ── その出現だけを待っている  |
 */
type GitWatchMode = 'git-directory' | 'workspace-root'

/**
 * 監視が落ちたときに張り直す回数の上限。
 *
 * `.git` がフォルダごと消える（別のリポジトリで上書きされる・`rm -rf .git`）と
 * 監視は error で終わる。1度は張り直したい（`workspace-root` へ落ちて、
 * 次の `git init` を待てる）が、**張り直しては落ちるを繰り返す形にはしない。**
 */
const MAX_RECOVERY_ATTEMPTS = 5

interface GitWatchSession {
  readonly workspaceId: string
  readonly rootPath: string
  readonly mode: GitWatchMode
  readonly watcher: FSWatcher
  /** 監視が落ちて張り直した回数（上限に達したら諦める）。 */
  readonly attempt: number
}

/**
 * 配るまでの間、変化が溜まっている状態。
 *
 * **watcher とは別に持つ。** `.git` が現れて張り先が切り替わるとき、
 * watcher は取り替わるが「配りたい変化」はそのまま残る ── 同じ器に入れると、
 * `git init` を検出したその変化が、切り替えの巻き添えで消える。
 */
interface GitChangeSignal {
  readonly workspaceId: string
  timer: ReturnType<typeof setTimeout> | null
  /** 溜まっている変化のうち、最初のものが届いた時刻。 */
  firstPendingAt: number
  /** 前に配った時刻。 */
  lastEmittedAt: number | null
}

let session: GitWatchSession | null = null
let signal: GitChangeSignal | null = null

/* ------------------------------------------------------------------ 配る側 */

/**
 * 変化が1つ届いた。配る時刻を決め直す。
 *
 * 何が届いたかは持たない ── 受け手がすることは常に「調べ直す」1つで、
 * 何回分が溜まっているかも意味を持たない（gitChangeSchedule.ts）。
 */
function signalGitChange(): void {
  const target = signal

  if (target === null) {
    return
  }

  const now = Date.now()

  if (target.timer === null) {
    target.firstPendingAt = now
  } else {
    clearTimeout(target.timer)
  }

  const delay = nextGitChangeDelayMs({
    now,
    firstPendingAt: target.firstPendingAt,
    lastEmittedAt: target.lastEmittedAt
  })

  target.timer = setTimeout(() => {
    target.timer = null
    emitGitChange(target)
  }, delay)
}

function emitGitChange(target: GitChangeSignal): void {
  /*
    束ねている間に Workspace が切り替わっていたら配らない。
    受け手も workspaceId を突き合わせて捨てるが、切り替わった後の通知を
    そもそも作らない方が素直（`files:changed` と同じ扱い。§9.6）。
  */
  if (signal !== target || getCurrentWorkspaceFolder()?.id !== target.workspaceId) {
    return
  }

  target.lastEmittedAt = Date.now()

  emitIpcEvent(IPC_EVENT_CHANNELS.GIT_CHANGED, { workspaceId: target.workspaceId })
}

/* ------------------------------------------------------------ 監視の開始 / 停止 */

/** そのパスが実在するフォルダか（`.git` はファイルのこともある ── worktree / submodule）。 */
function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function closeSession(): void {
  if (session === null) {
    return
  }

  session.watcher.close()
  session = null
}

function stopWatching(): void {
  closeSession()

  if (signal !== null && signal.timer !== null) {
    clearTimeout(signal.timer)
  }

  signal = null
}

/**
 * 監視を1つ張る。
 *
 * `.git` があればそれを再帰で、無ければ Workspace root を浅く見張る。
 * どちらも張れなくても**アプリを止める理由にはしない** ── 自動で気づけなく
 * なるだけで、Git パネルの更新ボタンと、操作の応答に載る状態は従来どおり効く。
 */
function beginSession(workspaceId: string, rootPath: string, attempt: number): void {
  const gitDirectoryPath = join(rootPath, GIT_DIRECTORY_NAME)
  const mode: GitWatchMode = isExistingDirectory(gitDirectoryPath)
    ? 'git-directory'
    : 'workspace-root'
  const watchedPath = mode === 'git-directory' ? gitDirectoryPath : rootPath

  let watcher: FSWatcher

  try {
    watcher = watch(watchedPath, {
      /*
        `.git` の中は refs / rebase-merge が階層を持つため再帰で見る。
        root 側は `.git` が現れたことだけを知りたいので浅く見る
        （再帰にすると `files:changed` と同じ木を二重に見張ることになる）。
      */
      recursive: mode === 'git-directory',
      // 監視がプロセスを生かし続けないようにする（app/lifecycle.ts の領分）。
      persistent: false
    })
  } catch (cause) {
    log.warn(`failed to watch "${watchedPath}"; git changes will not be detected.`, cause)
    return
  }

  const next: GitWatchSession = { workspaceId, rootPath, mode, watcher, attempt }
  session = next

  watcher.on('change', (_eventType, fileName) => {
    if (session !== next || fileName === null) {
      return
    }

    const raw = typeof fileName === 'string' ? fileName : fileName.toString('utf8')
    const relativePath = toGitWatchPath(raw)

    if (relativePath === null) {
      return
    }

    if (next.mode === 'git-directory') {
      if (isMeaningfulGitChange(relativePath)) {
        signalGitChange()
      }

      return
    }

    /*
      root を浅く見張っている間に拾うのは `.git` ただ1つ。
      それ以外の変化は `files:changed` の担当で、ここで拾うと
      「Git ではないフォルダで保存するたびに git を起動する」ことになる。
    */
    if (relativePath !== GIT_DIRECTORY_NAME) {
      return
    }

    // `not-a-repository` から抜けたかもしれない。まず伝える。
    signalGitChange()

    if (isExistingDirectory(gitDirectoryPath)) {
      log.info('the repository appeared; switching to watch its .git directory.')
      closeSession()
      beginSession(workspaceId, rootPath, 0)
    }
  })

  watcher.on('error', (cause) => {
    if (session !== next) {
      return
    }

    log.warn(`the git watcher on "${watchedPath}" stopped.`, cause)
    closeSession()

    if (attempt + 1 > MAX_RECOVERY_ATTEMPTS) {
      log.warn('giving up on watching git; the refresh button still works.')
      return
    }

    /*
      `.git` ごと消えた／作り直された可能性がある。どちらにせよ状態は
      変わっているので伝えたうえで、張り直す（消えていれば `workspace-root`
      へ落ち、次の `git init` を待てる）。
    */
    signalGitChange()
    beginSession(workspaceId, rootPath, attempt + 1)
  })

  log.info(`watching git for the workspace (${mode}): ${watchedPath}`)
}

function startWatching(workspaceId: string, rootPath: string): void {
  signal = { workspaceId, timer: null, firstPendingAt: 0, lastEmittedAt: null }
  beginSession(workspaceId, rootPath, 0)
}

/* ------------------------------------------------------------------ 入口 */

/**
 * `.git` の監視を始める（アプリの起動時に1度だけ）。
 *
 * 追従の形は workspaceWatcher.ts と揃えてある ── 切り替えのたびに
 * **前の watcher を必ず閉じてから**次を張る。閉じ忘れると、前の Workspace の
 * `.git` の変化が新しい Workspace の `workspaceId` で配られることになる。
 */
export function startGitWatching(): void {
  onWorkspaceFolderChange((workspace) => {
    stopWatching()

    if (workspace !== null) {
      startWatching(workspace.id, workspace.rootPath)
    }
  })

  const current = getCurrentWorkspaceFolder()

  if (current !== null) {
    startWatching(current.id, current.rootPath)
  }
}

/** 監視を止める（終了時）。 */
export function stopGitWatching(): void {
  stopWatching()
}
