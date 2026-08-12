import {
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  type StoredDockGroupNode,
  type StoredDockNode,
  type StoredDockSplitNode,
  type WorkspaceLayoutDocument
} from '@shared/workspace'
import { asDockNodeId } from '../layout/nodeId'
import { DEFAULT_LAYOUT_PRESET_ID, isLayoutPresetId, type LayoutPresetId } from '../layout/presets'
import {
  findLayoutProblems,
  isGroupNode,
  normalizeLayout,
  toSplitChildren,
  withSize
} from '../layout/tree'
import type { DockNode, SplitDirection, WorkspaceLayout } from '../layout/types'
import { isPanelId } from '../panels/registry'
import type { PanelId } from '../panels/types'

/**
 * 実行時のレイアウト（layout/types.ts）と保存形式（@shared/workspace）の相互変換。
 *
 * この層が引き受けるのは3つ。
 *   1. 保存する形へ落とす（serializeWorkspaceLayout）
 *   2. 古い保存データを今の形へ寄せる（マイグレーション）
 *   3. 読み込んだ内容を検証し、描画できるレイアウトに直す（deserializeWorkspaceLayout）
 *
 * layout/ と同じく React にも DOM にも依存しない純粋な関数だけを置く
 * （id の発番という副作用を伴う復元の入口は persistence/restoreLayout.ts）。
 *
 * **読み込みは常に疑ってかかる。** 保存ファイルは利用者が手で編集できる場所にあり、
 * アプリの更新でパネル構成やレイアウトの形が変わることもある。
 * そのため deserialize は「直せるものは直し、直せなければ失敗として返す」形にし、
 * 呼び出し側が Default Layout へ落とせるようにしてある。例外は投げない。
 *
 * 直すもの / 直さないものの線引き:
 *
 * | 内容                                   | 扱い                                          |
 * | -------------------------------------- | --------------------------------------------- |
 * | 未知の presetId                        | Default プリセットとして扱い、配置は残す      |
 * | activePanelId が領域の中身とずれている | 先頭のタブを手前に出す（normalizeLayout）     |
 * | 空になった領域・子が1つの split        | 畳む（normalizeLayout）                       |
 * | 同じパネルが2箇所にある                | 先に現れた方を残す（normalizeLayout）         |
 * | 未知の PanelId                         | 失敗（Default Layout へ）                     |
 * | 未知の kind / direction、size が負の数 | 失敗（Default Layout へ）                     |
 * | 非対応の schemaVersion                 | 失敗（Default Layout へ）                     |
 *
 * 未知の PanelId を「取り除いて続行」にしていないのは、それが起こるのは
 * パネルを廃止したときであり、そのときは schemaVersion を上げて
 * マイグレーションで畳むのが筋だから。マイグレーションを通してなお知らない PanelId が
 * 残っているなら、それは想定していない内容＝壊れたデータとして扱う。
 */

/** 復元の結果。失敗しても例外にはせず、理由を添えて返す（呼び出し側がログへ出す）。 */
export type LayoutRestoreResult =
  | {
      readonly ok: true
      readonly layout: WorkspaceLayout
      readonly presetId: LayoutPresetId
    }
  | {
      readonly ok: false
      /** 開発者向けの理由。UI には出さず、console / ログへ出す。 */
      readonly reason: string
    }

/**
 * schemaVersion N の layout を N+1 の形へ変換する関数の表。
 *
 * 保存形式を変えるときの手順:
 *   1. @shared/workspace の型を新しい形に合わせる
 *   2. WORKSPACE_LAYOUT_SCHEMA_VERSION を +1 する
 *   3. この表に「1つ前のバージョン番号 → 変換関数」を足す
 *   4. 変換関数のテストを書く（古い形の実データを入力にする）
 *
 * 変換関数の入力は unknown。古い形の型を残す必要は無く、その関数の中だけで
 * 「当時こういう形だった」を読み取れば足りる（型として残すと、廃止した形の定義が
 * いつまでも増え続ける）。
 *
 * 表に無いバージョンからの読み込みは失敗として扱い、Default Layout へ落とす。
 */
type StoredLayoutMigration = (layout: unknown) => unknown

const STORED_LAYOUT_MIGRATIONS: Readonly<Record<number, StoredLayoutMigration | undefined>> = {
  // 例: schemaVersion 2 を作るときは、1 からの変換をここに書く
  // 1: (layout) => ...
}

/** 今のレイアウトを保存する形に落とす。 */
export function serializeWorkspaceLayout(
  layout: WorkspaceLayout,
  presetId: LayoutPresetId
): WorkspaceLayoutDocument {
  return {
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    layout: {
      presetId,
      root: toStoredNode(layout.root)
    }
  }
}

/**
 * 2つのレイアウトが同じ配置かどうか。
 *
 * 使うのは復元の直後だけ。「保存されていた配置がプリセットそのものだったか」を判定し、
 * そうであればプリセット側のオブジェクトを採ることで、`modified`（＝変更あり）が
 * 参照の比較のまま成立するようにする（workspace/useWorkspaceLayout.ts）。
 * これが無いと、初期化した直後に再起動しただけで「変更あり」に見えてしまう。
 *
 * 比較に保存形式を使うのは、そこに「同じ配置とみなすべき情報」がちょうど揃っているため。
 */
export function isSameLayout(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
  // toStoredNode はキーの順序が固定なので、JSON 文字列の一致がそのまま構造の一致になる。
  return JSON.stringify(toStoredNode(a.root)) === JSON.stringify(toStoredNode(b.root))
}

/**
 * 保存データを実行時のレイアウトへ戻す。
 *
 * 失敗しても例外は投げない。呼び出し側は ok を見て Default Layout へ落とす。
 */
export function deserializeWorkspaceLayout(document: WorkspaceLayoutDocument): LayoutRestoreResult {
  const migrated = migrateStoredLayout(document)

  if (!migrated.ok) {
    return migrated
  }

  if (!isRecord(migrated.layout)) {
    return { ok: false, reason: 'layout がオブジェクトではありません' }
  }

  const problems: string[] = []
  const root = toDockNode(migrated.layout.root, problems)

  if (root === null) {
    return { ok: false, reason: `レイアウトの木を読めません: ${describe(problems)}` }
  }

  // 保存データの多少のずれ（空の領域・重複・activePanelId のずれ）はここで吸収する。
  const layout = normalizeLayout({ root })

  // 正規化しても直らない破綻が残っていないかを最後に確かめる。
  // ここを通った値だけを state に入れることで、描画側は不正な木を考えなくて済む。
  const remaining = findLayoutProblems(layout)

  if (remaining.length > 0) {
    return { ok: false, reason: `正規形になりません: ${describe(remaining)}` }
  }

  return { ok: true, layout, presetId: toPresetId(migrated.layout.presetId) }
}

/**
 * 保存データを今の schemaVersion の形まで引き上げる。
 *
 * 新しすぎる（このアプリより後のバージョンで保存された）データは、
 * 何が増えたのか分からないため下げられない。安全側に倒して失敗として扱う。
 */
export function migrateStoredLayout(
  document: WorkspaceLayoutDocument
):
  | { readonly ok: true; readonly layout: unknown }
  | { readonly ok: false; readonly reason: string } {
  if (document.schemaVersion > WORKSPACE_LAYOUT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason:
        `このアプリより新しい形式です（保存: ${document.schemaVersion} / ` +
        `対応: ${WORKSPACE_LAYOUT_SCHEMA_VERSION}）`
    }
  }

  let layout = document.layout

  for (let version = document.schemaVersion; version < WORKSPACE_LAYOUT_SCHEMA_VERSION; version++) {
    const migrate = STORED_LAYOUT_MIGRATIONS[version]

    if (migrate === undefined) {
      return { ok: false, reason: `schemaVersion ${version} からの移行手順がありません` }
    }

    layout = migrate(layout)
  }

  return { ok: true, layout }
}

/* -------------------------------------------------------------------------- */
/* 保存する向き                                                                */
/* -------------------------------------------------------------------------- */

function toStoredNode(node: DockNode): StoredDockNode {
  if (isGroupNode(node)) {
    const stored: StoredDockGroupNode = {
      kind: 'group',
      id: node.id,
      size: node.size,
      panelIds: [...node.panelIds],
      activePanelId: node.activePanelId
    }

    return stored
  }

  const stored: StoredDockSplitNode = {
    kind: 'split',
    id: node.id,
    size: node.size,
    direction: node.direction,
    children: node.children.map((child) => toStoredNode(child))
  }

  return stored
}

/* -------------------------------------------------------------------------- */
/* 読み込む向き                                                                */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 理由が増えても読める長さに収める（ログ用）。 */
function describe(problems: readonly string[]): string {
  return problems.slice(0, 3).join(' / ')
}

/**
 * プリセット id を解決する。
 *
 * 知らない値なら Default として扱い、配置そのものは残す。
 * presetId が決めるのは「閉じたパネルをどこへ戻すか」だけであり、
 * 利用者が組んだ配置の正しさには関わらないため、ここで配置ごと捨てる理由が無い
 * （プリセットが廃止された後の起動がこれに当たる）。
 */
function toPresetId(raw: unknown): LayoutPresetId {
  return typeof raw === 'string' && isLayoutPresetId(raw) ? raw : DEFAULT_LAYOUT_PRESET_ID
}

/** size は「正の数」か「残りを埋める（null）」のどちらか。 */
function toSize(raw: unknown, problems: string[]): number | null | undefined {
  if (raw === null) {
    return null
  }

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw
  }

  problems.push(`size が正の数でも null でもありません: ${String(raw)}`)

  return undefined
}

function toNodeId(raw: unknown, problems: string[]): string | null {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw
  }

  problems.push(`ノード id が文字列ではありません: ${String(raw)}`)

  return null
}

function toPanelIds(raw: unknown, problems: string[]): readonly PanelId[] | null {
  if (!Array.isArray(raw)) {
    problems.push('panelIds が配列ではありません')
    return null
  }

  const panelIds: PanelId[] = []

  for (const value of raw) {
    if (typeof value !== 'string' || !isPanelId(value)) {
      problems.push(`知らないパネルが含まれています: ${String(value)}`)
      return null
    }

    panelIds.push(value)
  }

  return panelIds
}

/**
 * 保存された1ノードを実行時の DockNode へ。読めなければ null を返す。
 *
 * ここでは「形として読めるか」だけを見て、木としての整合（空の領域・重複・
 * 子が1つの split）は normalizeLayout に任せる。
 * ただし子が0〜1件の split だけは、実行時の型（子は2つ以上）を作れないため
 * この場で畳んでおく。
 */
function toDockNode(raw: unknown, problems: string[]): DockNode | null {
  if (!isRecord(raw)) {
    problems.push('ノードがオブジェクトではありません')
    return null
  }

  const id = toNodeId(raw.id, problems)
  const size = toSize(raw.size, problems)

  if (id === null || size === undefined) {
    return null
  }

  if (raw.kind === 'group') {
    return toGroupNode(raw, id, size, problems)
  }

  if (raw.kind === 'split') {
    return toSplitNode(raw, id, size, problems)
  }

  problems.push(`知らない kind です: ${String(raw.kind)}`)

  return null
}

function toGroupNode(
  raw: Record<string, unknown>,
  id: string,
  size: number | null,
  problems: string[]
): DockNode | null {
  const panelIds = toPanelIds(raw.panelIds, problems)

  if (panelIds === null) {
    return null
  }

  const rawActive = raw.activePanelId

  if (rawActive !== null && (typeof rawActive !== 'string' || !isPanelId(rawActive))) {
    problems.push(`activePanelId が知らない値です: ${String(rawActive)}`)
    return null
  }

  // 中身とずれている（この領域に無いパネルを指している）場合は normalizeLayout が直す。
  const activePanelId: PanelId | null = rawActive

  // 空の領域（＝すべてのパネルを閉じた状態）はそのまま通す。木として不要なら
  // normalizeLayout が取り除き、root なら残る。
  return { kind: 'group', id: asDockNodeId(id), size, panelIds, activePanelId }
}

function toSplitNode(
  raw: Record<string, unknown>,
  id: string,
  size: number | null,
  problems: string[]
): DockNode | null {
  const direction = toSplitDirection(raw.direction, problems)

  if (direction === null) {
    return null
  }

  if (!Array.isArray(raw.children)) {
    problems.push('split の children が配列ではありません')
    return null
  }

  const children: DockNode[] = []

  for (const child of raw.children) {
    const node = toDockNode(child, problems)

    if (node === null) {
      return null
    }

    children.push(node)
  }

  if (children.length === 0) {
    problems.push(`split に子がありません: ${id}`)
    return null
  }

  // 子が1つの split は実行時の型として存在しない。畳んで、箱の大きさを子へ引き継ぐ。
  if (children.length === 1) {
    return withSize(children[0], size)
  }

  return {
    kind: 'split',
    id: asDockNodeId(id),
    size,
    direction,
    children: toSplitChildren(children)
  }
}

function toSplitDirection(raw: unknown, problems: string[]): SplitDirection | null {
  if (raw === 'row' || raw === 'column') {
    return raw
  }

  problems.push(`知らない direction です: ${String(raw)}`)

  return null
}
