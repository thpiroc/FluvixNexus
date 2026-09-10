import {
  DEBUG_BREAKPOINTS_MAX_WORKSPACES,
  DEBUG_BREAKPOINTS_SCHEMA_VERSION,
  type DebugBreakpoint,
  type StoredDebugBreakpointWorkspace
} from '@shared/debug'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import type { WorkspaceFolder } from '@shared/workspace'
import { emitIpcEvent } from '../ipc/events'
import { createLogger } from '../logger'
import {
  readDebugBreakpointsDocument,
  saveDebugBreakpointsDocument
} from '../store/debugBreakpoints'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import {
  clearDebugBreakpointVerification,
  createDebugBreakpointRecord,
  listDebugBreakpointPaths,
  normalizeDebugBreakpointRecords,
  toDebugBreakpointLines,
  toDebugBreakpoints,
  toggleDebugBreakpointRecord,
  toStoredDebugBreakpoints,
  type DebugBreakpointRecord
} from './breakpointModel'
import { normalizeDebugBreakpointPath, resolveDebugBreakpointSource } from './breakpointSource'
import {
  applyDebugBreakpointSyncOutcomes,
  sendDebugBreakpoints,
  type DebugBreakpointSyncOutcome,
  type DebugBreakpointSyncTarget
} from './breakpointSync'
import {
  getDebugSessionBreakpointChannel,
  getDebugSessionGeneration,
  getDebugSessionState,
  onDebugSessionStateChange,
  setDebugSessionConfigurationHook,
  type DebugSessionBreakpointChannel
} from './debugSessionManager'

/**
 * 今の Workspace の breakpoint の正本（Session 6-3）。
 *
 * ```
 * Renderer（Monaco の glyph margin）
 *    ↓  relativePath + line
 * main/ipc/handlers/debug.ts     境界の外から来た値を確かめる
 *    ↓
 * ここ                            控え・保存・通知・adapter への同期
 *    ↓  Source（絶対パス）+ 行の並び
 * main/debug/breakpointSync.ts   setBreakpoints 1往復
 * ```
 *
 * 判断のうち**純粋なもの**は分けてある（この層は噛み合わせだけを持つ）。
 *
 * ```
 * breakpointModel.ts   入れ替え・重複・並び・adapter の答えの当て方
 * breakpointSource.ts  相対位置 → DAP の Source（Workspace の外なら null）
 * breakpointSync.ts    1ファイルぶんの送信と応答の読み取り
 * store/debugBreakpointsDocument.ts  保存ファイルの検証
 * ```
 *
 * ## Debug Session が無くても完結する
 *
 * この層は adapter の有無を前提にしない。セッションが動いていなければ、
 * 控えて・保存して・通知するところまでで終わる ── **走らせる前に印を
 * 付けられること**が breakpoint の最初の役目にほかならない。
 *
 * ## セッションとの同期は2つの経路がある
 *
 * ```
 * 開始時   … configurationHook（initialized → configurationDone の間。§20.8）
 * 変更時   … getDebugSessionBreakpointChannel()（running / stopped の間だけ返る）
 * ```
 *
 * どちらも同じ `syncBreakpointsWith` を通る。違うのは「いつ呼ばれるか」だけで、
 * 送る中身の決め方は1つにしてある。
 *
 * ## 世代を跨いだ応答を当てない
 *
 * `setBreakpoints` の応答は非同期に返る。返ってきた時点でセッションが
 * 入れ替わっていたら**捨てる** ── 前のセッションの verified を新しい印へ
 * 当てると、走ってもいない adapter が「置けた」と言ったことになる（§20.8）。
 *
 * ## Workspace が変わったら読み直す
 *
 * 相対位置は Workspace が変われば**別のファイル**を指す。切り替えの時点で
 * 控えを捨て、新しい Workspace の保存内容から読み直す（Editor の Model や
 * LSP の控えと同じ扱い）。
 */

const log = createLogger('debug-breakpoints')

/** 今の Workspace（切り替えの検知に使う。正本は currentWorkspaceFolder.ts）。 */
let workspace: WorkspaceFolder | null = null

/** 今の Workspace の控え。 */
let records: readonly DebugBreakpointRecord[] = []

/** 保存内容からの読み直しを済ませたか（Workspace ごとに1度）。 */
let restoredRootPath: string | null = null

/**
 * 今のセッションで1度でも `setBreakpoints` を送ったファイル。
 *
 * 最後の1件を外したときに**空の配列を送る**判断に使う（breakpointSync.ts）。
 * 送っていないファイルへ空を送るのは無駄な往復にしかならない。
 */
let syncedPaths = new Set<string>()

/** そのファイルたちを送った時点のセッション世代。 */
let syncedGeneration = -1

/* ------------------------------------------------------------------ 読み書き */

/** 今の Workspace の breakpoint（Renderer へ返す形）。 */
export function listDebugBreakpoints(): readonly DebugBreakpoint[] {
  ensureRestored()

  return toDebugBreakpoints(records)
}

export type ToggleDebugBreakpointResult =
  | { readonly status: 'changed'; readonly breakpoints: readonly DebugBreakpoint[] }
  /** Workspace が開かれていない。 */
  | { readonly status: 'no-workspace' }
  /** 行として受け取れない値。 */
  | { readonly status: 'invalid-line' }
  /** Workspace の外を指している（または相対位置として扱えない）。 */
  | { readonly status: 'outside-workspace' }
  /** その Workspace の上限に達している。 */
  | { readonly status: 'limit-reached' }

/**
 * その位置の breakpoint を入れ替える。
 *
 * 相対位置の検証はここで**必ず**通る（`resolveDebugBreakpointSource`）。
 * Debug Session が動いていない間も検証は同じで、「セッションが無いから
 * 送らないので確かめなくてよい」にはしない ── 保存されてしまえば、
 * 次にセッションが始まった時点で送られることになる。
 */
export function toggleDebugBreakpoint(
  rawRelativePath: unknown,
  rawLine: unknown
): ToggleDebugBreakpointResult {
  ensureRestored()

  const current = workspace

  if (current === null) {
    return { status: 'no-workspace' }
  }

  const source = resolveDebugBreakpointSource(current.rootPath, rawRelativePath)

  if (source === null) {
    return { status: 'outside-workspace' }
  }

  // 検証を通った相対位置だけを控えの鍵にする（source と同じ手順から出てきたもの）。
  const relativePath = normalizeDebugBreakpointPath(rawRelativePath)

  if (relativePath === null) {
    return { status: 'outside-workspace' }
  }

  const outcome = toggleDebugBreakpointRecord(records, relativePath, rawLine)

  if (outcome.status === 'invalid-line') {
    return { status: 'invalid-line' }
  }

  if (outcome.status === 'limit-reached') {
    return { status: 'limit-reached' }
  }

  records = outcome.records
  persist()
  notify()
  void syncPathWithSession(relativePath)

  return { status: 'changed', breakpoints: toDebugBreakpoints(records) }
}

/* ------------------------------------------------------------ Workspace 追従 */

/**
 * Workspace の切り替えと Debug Session の仕込みを購読する。
 *
 * `startDebugSessionHosting`（Session 6-2）と同じ形で、呼ぶのは
 * main/app/lifecycle.ts 1箇所だけになる。
 */
export function startDebugBreakpointHosting(
  onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
): void {
  onWorkspaceChange((next) => {
    applyWorkspace(next)
  })

  setDebugSessionConfigurationHook(async (channel) => {
    await synchronizeAllWithSession(channel)
  })

  /*
    セッションが終わったら adapter の答えを忘れる。

    忘れないと、**前のセッションで置けた印が、走っていない今も「置けた」を
    主張し続ける。** verified は「今動いている adapter がどう答えたか」であって、
    breakpoint そのものの性質ではない（breakpointModel.ts）。
    印そのものは残る ── 消えるのは色だけになる。
  */
  onDebugSessionStateChange((state) => {
    if (state !== 'idle') {
      return
    }

    syncedPaths = new Set()
    syncedGeneration = -1

    const cleared = clearDebugBreakpointVerification(records)

    if (cleared !== records) {
      records = cleared
      notify()
    }
  })
}

/**
 * Workspace が変わった。控えを捨て、新しい Workspace の保存内容から読み直す。
 *
 * 通知は必ず出す ── 空になったことも Renderer は知る必要がある
 * （前の Workspace の印が画面に残らないようにするため）。
 */
function applyWorkspace(next: WorkspaceFolder | null): void {
  workspace = next
  records = []
  restoredRootPath = null
  syncedPaths = new Set()
  syncedGeneration = -1

  ensureRestored()
  notify()
}

/** 保存内容からの読み直し（Workspace ごとに1度だけ）。 */
function ensureRestored(): void {
  const current = getCurrentWorkspaceFolder()

  /*
    購読より先に IPC が届くことがある（起動直後）。正本を毎回読み、
    食い違っていればそこで読み直す ── ここが「今どの Workspace の話か」の
    答えを1つに保つ場所になる。
  */
  if (current?.rootPath !== workspace?.rootPath) {
    workspace = current
    records = []
    restoredRootPath = null
    syncedPaths = new Set()
    syncedGeneration = -1
  }

  if (current === null || restoredRootPath === current.rootPath) {
    return
  }

  restoredRootPath = current.rootPath
  records = readRecordsFor(current.rootPath)
}

/**
 * 保存内容から、その Workspace の控えを組み立てる。
 *
 * 保存ファイルは利用者が手で編集できる場所にある（userData 配下）ので、
 * **読み込んだ相対位置も境界の外から来た値として扱う** ── `..` や絶対パスが
 * 書かれていれば、その1件だけを落とす。
 */
function readRecordsFor(rootPath: string): readonly DebugBreakpointRecord[] {
  const stored = readDebugBreakpointsDocument()?.workspaces[rootPath]

  if (stored === undefined) {
    return []
  }

  const restored: DebugBreakpointRecord[] = []
  let rejected = 0

  for (const entry of stored.breakpoints) {
    const relativePath = normalizeDebugBreakpointPath(entry.relativePath)

    if (relativePath === null || resolveDebugBreakpointSource(rootPath, relativePath) === null) {
      rejected += 1
      continue
    }

    restored.push({
      ...createDebugBreakpointRecord(relativePath, entry.line),
      enabled: entry.enabled
    })
  }

  if (rejected > 0) {
    log.warn(`ignored ${String(rejected)} saved breakpoints that are not inside the workspace.`)
  }

  return normalizeDebugBreakpointRecords(restored)
}

/** 今の Workspace のぶんを保存へ書き戻す（他の Workspace の分はそのまま残す）。 */
function persist(): void {
  const current = workspace

  if (current === null) {
    return
  }

  const document = readDebugBreakpointsDocument()
  const entry: StoredDebugBreakpointWorkspace = {
    updatedAt: Date.now(),
    breakpoints: toStoredDebugBreakpoints(records)
  }

  const merged: Record<string, StoredDebugBreakpointWorkspace> = {
    ...(document?.workspaces ?? {}),
    [current.rootPath]: entry
  }

  saveDebugBreakpointsDocument({
    schemaVersion: DEBUG_BREAKPOINTS_SCHEMA_VERSION,
    workspaces: trimWorkspaces(merged, current.rootPath)
  })
}

/**
 * 覚えておく Workspace の数を上限に収める。
 *
 * 落とすのは**今開いている Workspace 以外で最も古いもの**。今開いている分は
 * 常に残す ── そこが落ちると、印を付けた直後に消える経路ができてしまう。
 */
function trimWorkspaces(
  workspaces: Record<string, StoredDebugBreakpointWorkspace>,
  keepRootPath: string
): Record<string, StoredDebugBreakpointWorkspace> {
  const entries = Object.entries(workspaces)

  if (entries.length <= DEBUG_BREAKPOINTS_MAX_WORKSPACES) {
    return workspaces
  }

  const others = entries
    .filter(([rootPath]) => rootPath !== keepRootPath)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, DEBUG_BREAKPOINTS_MAX_WORKSPACES - 1)

  const kept = workspaces[keepRootPath]

  return Object.fromEntries(kept === undefined ? others : [[keepRootPath, kept], ...others])
}

/** 今の一覧を Renderer へ配る。 */
function notify(): void {
  emitIpcEvent(IPC_EVENT_CHANNELS.DEBUG_BREAKPOINTS_CHANGED, {
    workspaceId: workspace?.id ?? '',
    breakpoints: toDebugBreakpoints(records)
  })
}

/* ------------------------------------------------- Debug Session との同期 */

/**
 * セッションの開始時に、今の印を丸ごと送る。
 *
 * 呼ばれるのは `initialized` の後・`configurationDone` の前だけ（§20.8）。
 * ここで送り終えたファイルを覚えておき、以降の変更では**そのファイルだけ**を
 * 送り直す（最後の1件を外したときに空を送れるようにするため）。
 */
async function synchronizeAllWithSession(channel: DebugSessionBreakpointChannel): Promise<void> {
  ensureRestored()

  const current = workspace

  if (current === null) {
    return
  }

  /*
    前のセッションの答えを持ち越さない。新しい adapter は別の判断をするので、
    送り直すまでは「まだ分からない」が正しい状態になる。
  */
  records = clearDebugBreakpointVerification(records)
  syncedPaths = new Set()
  syncedGeneration = channel.generation
  notify()

  const targets = listDebugBreakpointPaths(records)
    .map((relativePath) => createTarget(current.rootPath, relativePath))
    .filter((target): target is DebugBreakpointSyncTarget => target !== null)

  if (targets.length === 0) {
    return
  }

  const outcomes: DebugBreakpointSyncOutcome[] = []

  for (const target of targets) {
    syncedPaths.add(target.relativePath)
    outcomes.push(await sendDebugBreakpoints(channel, target))
  }

  applyOutcomes(channel, outcomes)
}

/**
 * 変更のあった1ファイルを、動いているセッションへ送り直す。
 *
 * セッションが無い / まだ起動中なら何もしない ── 起動中の同期は
 * `synchronizeAllWithSession` が引き受ける（debugSessionManager.ts）。
 */
async function syncPathWithSession(relativePath: string): Promise<void> {
  const channel = getDebugSessionBreakpointChannel()
  const current = workspace

  if (channel === null || current === null) {
    return
  }

  // 別のセッションになっていれば、送った控えも作り直す。
  if (syncedGeneration !== channel.generation) {
    syncedPaths = new Set()
    syncedGeneration = channel.generation
  }

  const target = createTarget(current.rootPath, relativePath)

  if (target === null) {
    return
  }

  /*
    まだ1度も送っていないファイルへ、空の配列を送らない。
    adapter 側にそのファイルの印は無いので、外す要求に意味が無い。
  */
  if (target.lines.length === 0 && !syncedPaths.has(relativePath)) {
    return
  }

  syncedPaths.add(relativePath)
  applyOutcomes(channel, [await sendDebugBreakpoints(channel, target)])
}

/** 1ファイルぶんの送信対象を組み立てる（Workspace の外なら null）。 */
function createTarget(rootPath: string, relativePath: string): DebugBreakpointSyncTarget | null {
  const source = resolveDebugBreakpointSource(rootPath, relativePath)

  return source === null
    ? null
    : { relativePath, source, lines: toDebugBreakpointLines(records, relativePath) }
}

/**
 * 応答を控えへ当てる。
 *
 * **送った時点と同じセッションでなければ捨てる。** 応答が返るまでの間に
 * セッションが終わる / 入れ替わることは普通に起きる（§20.8）。
 *
 * 世代と状態を**対で**見るのが要点になる。世代だけでは「終わった後に、
 * 新しいセッションがまだ始まっていない」（世代は据え置きのまま `idle`）を
 * 区別できず、走っていない adapter の答えを当ててしまう。
 * 状態だけでも足りない ── 新しいセッションが同じ `running` に居るときに、
 * 前のセッションの答えを当てることになる。
 */
function applyOutcomes(
  channel: DebugSessionBreakpointChannel,
  outcomes: readonly DebugBreakpointSyncOutcome[]
): void {
  const state = getDebugSessionState()

  if (
    getDebugSessionGeneration() !== channel.generation ||
    state === 'idle' ||
    state === 'terminating'
  ) {
    log.debug('dropped a stale setBreakpoints response from a previous debug session.')
    return
  }

  for (const outcome of outcomes) {
    if (outcome.failure !== null) {
      log.warn(`setBreakpoints failed for "${outcome.relativePath}": ${outcome.failure}`)
    }
  }

  records = applyDebugBreakpointSyncOutcomes(records, outcomes)
  notify()
}
