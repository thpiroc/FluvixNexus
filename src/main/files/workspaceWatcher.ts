import { watch, type FSWatcher } from 'fs'
import { lstat } from 'fs/promises'
import { join } from 'path'
import type { FileRevision, WorkspaceFileChange } from '@shared/files'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { createLogger } from '../logger'
import { emitIpcEvent } from '../ipc/events'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../workspaceFolder/currentWorkspaceFolder'
import {
  dropPathsUnderDeleted,
  isIgnoredWatchPath,
  toWorkspaceRelativeWatchPath
} from './watchPaths'

/**
 * 現在の Workspace を監視し、アプリの外で起きた変化を Renderer へ配る。
 *
 * ## Renderer に filesystem の監視 API を渡さない
 *
 * 監視するのは Main で、Renderer が受け取るのは既存の `files:changed`
 * （ARCHITECTURE.md §3.3）だけ。**この経路はアプリの中の操作と同じもの**で、
 * 変化1件の形（shared/files/change.ts）も同じにしてある。
 * 受け手（Files のツリー・Editor のタブ・Monaco の Model）は Session 3-3 から
 * 変わらず、増えたのは `modified` の扱いだけになる。
 *
 * ```
 * fs.watch（root 1つ・再帰）
 *    ↓  絶対パス
 * watchPaths.ts        相対位置へ落とし、境界の外と除外対象を捨てる
 *    ↓  相対位置
 * ここ                 lstat で「今どうなっているか」を見て変化の種類を決める
 *    ↓  WorkspaceFileChange[]
 * emitIpcEvent('files:changed', { source: 'watcher', … })
 * ```
 *
 * ## 監視は root に1つだけ
 *
 * フォルダごとに watcher を張らない。展開されたフォルダの数だけハンドルが増え、
 * 深いツリーでは OS の上限に当たる。Windows の再帰監視は
 * ReadDirectoryChangesW 1本で済むため、**開いている範囲に依存しない**。
 *
 * この形にしてあるので、Files Tree 全体の追従（今は Editor が使う `modified` を
 * 優先しているが、created / deleted / renamed も同じ束で届いている）へ
 * そのまま広げられる。
 *
 * ## 束ねてから配る
 *
 * 1回の保存でも OS からは複数の通知が来る（rename → change、属性の更新）。
 * そのまま配ると、受け手が同じフォルダを何度も読み直す。
 * 短い時間で束ね、位置ごとに1つの結末へ畳んでから配る。
 *
 * ## 自分の操作は配らない
 *
 * アプリ自身の作成 / 改名 / 削除 / 保存でも監視は発火する。それをそのまま配ると、
 * 1回の操作に対して `files:changed` が2回流れ、Files パネルが同じフォルダを
 * 2度読み直すことになる（Session 3-3 の「読み直すのは親1つだけ」が崩れる）。
 * 操作した側が `noteAppFileChange` で位置を控え、監視側はその位置を短い間だけ黙らせる。
 */

const log = createLogger('workspace-watcher')

/**
 * 束ねる時間（ミリ秒）。
 *
 * 短すぎると1回の保存が複数の通知に分かれ、長すぎると外部変更に気づくのが遅れる。
 * 「ビルドツールが書き終わるのを待つ」ほど長くはせず、体感に出ない範囲に留める。
 */
const COALESCE_DELAY_MS = 120

/**
 * 自分の操作を黙らせる時間（ミリ秒）。
 *
 * 書き込みから OS の通知が届くまでの間だけ効けばよい。長くすると、
 * 保存した直後に外部で書き換えられた変化まで捨てることになる。
 */
const SELF_CHANGE_QUIET_MS = 1500

/** 1回の束で配る上限。桁違いの変化（大量コピー・checkout）で Renderer を埋めない。 */
const MAX_CHANGES_PER_BATCH = 500

interface WatchSession {
  readonly workspaceId: string
  readonly rootPath: string
  readonly watcher: FSWatcher
  /** 束ねている最中の位置と、その間に届いた生のイベント種別。 */
  readonly pending: Map<string, Set<string>>
  timer: ReturnType<typeof setTimeout> | null
}

let session: WatchSession | null = null

/** アプリ自身が触った位置と、その時刻。 */
const selfChangedAt = new Map<string, number>()

/**
 * アプリ自身がその位置を書き換えたことを控える。
 *
 * 呼ぶのは ipc/handlers/files.ts（作成 / 改名 / 削除 / 保存が成功した直後）。
 * 監視は自分の書き込みと外部の書き込みを区別できないため、
 * **区別できる側が申告する**形にしてある。
 */
export function noteAppFileChange(relativePaths: readonly string[]): void {
  /*
    見張っていないなら、黙らせる相手も居ない。

    監視は失敗しうる（再帰監視が使えない OS・root が消えた）。そのとき
    ここで控え続けると、**誰も片付けない控えが操作のたびに増える**
    （期限切れを片付けるのは監視側の flush だけのため）。
  */
  if (session === null) {
    return
  }

  const now = Date.now()

  for (const relativePath of relativePaths) {
    selfChangedAt.set(relativePath, now)
  }
}

function isRecentSelfChange(relativePath: string, now: number): boolean {
  const at = selfChangedAt.get(relativePath)

  if (at === undefined) {
    return false
  }

  if (now - at > SELF_CHANGE_QUIET_MS) {
    selfChangedAt.delete(relativePath)
    return false
  }

  return true
}

/** 期限切れの控えを片付ける（申告された位置が積み上がらないように）。 */
function forgetStaleSelfChanges(now: number): void {
  for (const [relativePath, at] of selfChangedAt) {
    if (now - at > SELF_CHANGE_QUIET_MS) {
      selfChangedAt.delete(relativePath)
    }
  }
}

/* ------------------------------------------------------------ 監視の開始 / 停止 */

function stopWatching(): void {
  if (session === null) {
    return
  }

  if (session.timer !== null) {
    clearTimeout(session.timer)
  }

  session.watcher.close()
  session = null
  selfChangedAt.clear()
}

function startWatching(workspaceId: string, rootPath: string): void {
  let watcher: FSWatcher

  try {
    watcher = watch(rootPath, {
      // 展開の状態に依存しない1本の監視にするため（このファイルの冒頭）。
      recursive: true,
      /*
        監視がプロセスを生かし続けないようにする。終了の判断は
        app/lifecycle.ts が持つもので、監視が引き延ばしてよいものではない。
      */
      persistent: false
    })
  } catch (cause) {
    /*
      再帰監視は OS によっては使えない（Linux）。root が消えた直後にも失敗する。
      **どちらもアプリを止める理由にはしない。** 監視が無ければ
      外部変更に自動で気づけなくなるだけで、Files パネルの再読み込みと
      保存時の版の確認（writeWorkspaceFile.ts）は従来どおり効く。
    */
    log.warn(`failed to watch the workspace; external changes will not be detected.`, cause)
    return
  }

  const next: WatchSession = {
    workspaceId,
    rootPath,
    watcher,
    pending: new Map(),
    timer: null
  }

  session = next

  watcher.on('change', (eventType, fileName) => {
    if (session !== next || fileName === null) {
      return
    }

    // 再帰監視では root からの相対位置が届く（OS の区切り文字のまま）。
    const raw = typeof fileName === 'string' ? fileName : fileName.toString('utf8')
    const relativePath = toWorkspaceRelativeWatchPath(rootPath, join(rootPath, raw))

    if (relativePath === null || isIgnoredWatchPath(relativePath)) {
      return
    }

    const seen = next.pending.get(relativePath)

    if (seen === undefined) {
      next.pending.set(relativePath, new Set([eventType]))
    } else {
      seen.add(eventType)
    }

    if (next.timer === null) {
      next.timer = setTimeout(() => {
        next.timer = null
        void flush(next)
      }, COALESCE_DELAY_MS)
    }
  })

  watcher.on('error', (cause) => {
    if (session !== next) {
      return
    }

    // root ごと消えた / 取り外された。落とさずに監視だけをやめる。
    log.warn('the workspace watcher stopped.', cause)
    stopWatching()
  })

  log.info(`watching the workspace: ${rootPath}`)
}

/* ------------------------------------------------------------------ 変化の判定 */

/**
 * 束ねた位置を「今どうなっているか」から変化へ落とす。
 *
 * 監視が伝えるのは「この位置で何か起きた」までで、**何が起きたかは
 * ディスクを見て決める**。OS のイベント種別だけでは、
 * 「作られた」と「別のファイルが rename で被せられた」の区別が付かない。
 */
async function resolveChanges(
  rootPath: string,
  pending: ReadonlyMap<string, ReadonlySet<string>>
): Promise<readonly WorkspaceFileChange[]> {
  const now = Date.now()
  const paths = [...pending.keys()].filter((relativePath) => !isRecentSelfChange(relativePath, now))

  forgetStaleSelfChanges(now)

  const resolved: { relativePath: string; changes: WorkspaceFileChange[] }[] = []
  const deletedPaths: string[] = []

  for (const relativePath of paths) {
    const events = pending.get(relativePath) ?? new Set<string>()
    const changes: WorkspaceFileChange[] = []

    let stats: Awaited<ReturnType<typeof lstat>> | null = null

    try {
      /*
        lstat（realpath を辿らない）で見る。ここで知りたいのは
        「Workspace の中のその位置に何があるか」であって、指し先の実体ではない。
        中身を読む・書くわけではないため、境界の話にもならない。
      */
      stats = await lstat(join(rootPath, relativePath))
    } catch {
      // 消えた（ENOENT）／読めない。どちらも「もう無い」として扱う。
      stats = null
    }

    if (stats === null) {
      changes.push({ kind: 'deleted', relativePath, entryType: null })
      deletedPaths.push(relativePath)
    } else if (stats.isDirectory()) {
      /*
        フォルダは「現れた」ときだけ配る。中身が増減したときにも
        フォルダ自身の 'change' が届くが、その中身は配下の変化として
        別に届いているので、配ると同じフォルダを二重に読み直すことになる。
      */
      if (events.has('rename')) {
        changes.push({ kind: 'created', relativePath, entryType: 'directory' })
      }
    } else {
      /*
        ファイル。

        位置として現れた（rename）なら created、中身が変わったなら modified。
        **両方を配ることがある。** 外部のエディタの多くは
        「一時ファイルへ書いて rename で被せる」ため、1回の保存が
        「現れた」としても届く。片方に決めてしまうと、
        ツリーの追従（created）か Editor の追従（modified）のどちらかが落ちる。
      */
      if (events.has('rename')) {
        changes.push({ kind: 'created', relativePath, entryType: 'file' })
      }

      changes.push({
        kind: 'modified',
        relativePath,
        entryType: 'file',
        revision: toRevision(stats)
      })
    }

    if (changes.length > 0) {
      resolved.push({ relativePath, changes })
    }
  }

  // フォルダごと消えた場合、その配下の1件ずつは意味を持たない。
  const kept = new Set(
    dropPathsUnderDeleted(
      resolved.map((item) => item.relativePath),
      deletedPaths
    )
  )

  return resolved
    .filter((item) => kept.has(item.relativePath))
    .flatMap((item) => item.changes)
    .slice(0, MAX_CHANGES_PER_BATCH)
}

function toRevision(stats: { mtimeMs: number; size: number }): FileRevision {
  return { mtimeMs: stats.mtimeMs, size: stats.size }
}

async function flush(target: WatchSession): Promise<void> {
  const pending = new Map(target.pending)
  target.pending.clear()

  if (pending.size === 0) {
    return
  }

  const changes = await resolveChanges(target.rootPath, pending)

  if (changes.length === 0) {
    return
  }

  /*
    束ねている間に Workspace が切り替わっていたら配らない。
    受け手も workspaceId を突き合わせて捨てるが、切り替わった後の
    通知をそもそも作らない方が素直（応答側と同じ扱い。§9.6）。
  */
  if (session !== target || getCurrentWorkspaceFolder()?.id !== target.workspaceId) {
    return
  }

  emitIpcEvent(IPC_EVENT_CHANNELS.FILES_CHANGED, {
    workspaceId: target.workspaceId,
    source: 'watcher',
    changes
  })
}

/* ------------------------------------------------------------------ 入口 */

/**
 * Workspace の監視を始める（アプリの起動時に1度だけ）。
 *
 * 監視の対象は「今開いている Workspace」なので、開く / 閉じる / 切り替えに追従する。
 * 追従の仕方を currentWorkspaceFolder.ts 側に書かないのは、
 * **正本が監視の都合を知らずに済むようにする**ため（Files / Terminal / Git も
 * 同じように「今の Workspace」を読むだけの関係でいる）。
 */
export function startWorkspaceWatching(): void {
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
export function stopWorkspaceWatching(): void {
  stopWatching()
}
