import type { SaveSettingsSectionRequest, WorkspaceSettingsSnapshot } from '@shared/ipc'
import {
  emptySettingsSections,
  isWorkspaceScopedSection,
  type SettingsScope,
  type SettingsSectionId,
  type SettingsSections,
  type SettingsSectionUpdate
} from '@shared/settings'

/**
 * ユーザー設定 / ワークスペース設定の写しと、書き込みの組み立て（React 非依存。feature/settings-scope）。
 *
 * Renderer はディスクの2つの scope をそのまま写して持ち、**効く値は
 * shared/settings/scope.ts の `resolveEffectiveSettings` で毎回組み立てる。**
 * 効く値を別に保存しないのは、「どちらの scope に書いたか」と「何が効いているか」の
 * 2つを別々に持つと、食い違う瞬間が生まれるため。
 *
 * ## どの scope へ書くか
 *
 * | 書き込みの入口                           | 行き先                                       |
 * | ---------------------------------------- | -------------------------------------------- |
 * | Settings 画面（ユーザー を選んでいる）    | ユーザー設定                                 |
 * | Settings 画面（ワークスペース を選んでいる）| ワークスペース設定                          |
 * | それ以外（Files のツールバー・Terminal の ⚙・Ctrl + ＋ など） | **その key を今決めている scope**（`auto`） |
 *
 * `auto` は VS Code の「値が定義されている一番内側の scope へ書く」と同じ考え方で、
 * ワークスペース設定で上書きしている key をツールバーから変えたら
 * ワークスペース設定が変わる。ユーザー設定へ書くと、押しても画面が変わらない
 * （上書きされたまま）ことになるため。
 *
 * ## key 単位で書く
 *
 * 書くのは**変わった key だけ**。ワークスペース設定で文字の大きさを変えたときに、
 * さかのぼれる行数まで一緒にワークスペースへ固定しない
 * （固定すると、後でユーザー設定の行数を変えてもこのプロジェクトにだけ効かない）。
 */

export type SettingsWriteTarget = SettingsScope | 'auto'

export type SettingsScopeState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly user: SettingsSections
      readonly workspace: WorkspaceSettingsSnapshot | null
    }

export type ReadySettingsScopeState = Extract<SettingsScopeState, { status: 'ready' }>

/** 読み込めなかったとき（既定で始める。設定が読めないことはアプリを使えない理由にならない）。 */
export function fallbackSettingsScopeState(): ReadySettingsScopeState {
  return { status: 'ready', user: emptySettingsSections(), workspace: null }
}

/** 組み立てた書き込み（写しの次の形と、Main へ送る要求）。 */
export interface PlannedSettingsWrite {
  readonly next: ReadySettingsScopeState
  readonly requests: readonly SaveSettingsSectionRequest[]
}

/**
 * 値が `before` から `after` へ変わったことを、どの scope のどの section へ書くかに直す。
 *
 * `before` / `after` は `toStored` を通した section の形。書くものが無ければ
 * `requests` は空になる（写しも変わらない）。
 */
export function planSettingsWrite(
  state: ReadySettingsScopeState,
  section: SettingsSectionId,
  before: object,
  after: object,
  target: SettingsWriteTarget
): PlannedSettingsWrite {
  const changed = changedEntries(before, after)

  if (changed.length === 0) {
    return { next: state, requests: [] }
  }

  const workspaceValues = readSection(state.workspace?.sections, section)
  const canUseWorkspace = state.workspace !== null && isWorkspaceScopedSection(section)

  const forUser: Array<readonly [string, unknown]> = []
  const forWorkspace: Array<readonly [string, unknown]> = []

  for (const entry of changed) {
    const scope = chooseScope(target, canUseWorkspace, workspaceValues[entry[0]] !== undefined)

    if (scope === 'user') {
      forUser.push(entry)
    } else if (scope === 'workspace') {
      forWorkspace.push(entry)
    }
  }

  return applyEntries(state, section, forUser, forWorkspace)
}

/**
 * ワークスペース設定の上書きを外す（「ユーザー設定に戻す」）。
 *
 * key を消した section を書くだけで、ユーザー設定には触れない。
 */
export function planWorkspaceReset(
  state: ReadySettingsScopeState,
  section: SettingsSectionId,
  keys: readonly string[]
): PlannedSettingsWrite {
  const workspace = state.workspace

  if (workspace === null) {
    return { next: state, requests: [] }
  }

  const current = readSection(workspace.sections, section)

  if (!keys.some((key) => current[key] !== undefined)) {
    return { next: state, requests: [] }
  }

  return applyEntries(
    state,
    section,
    [],
    keys.map((key) => [key, undefined] as const)
  )
}

function chooseScope(
  target: SettingsWriteTarget,
  canUseWorkspace: boolean,
  overriddenInWorkspace: boolean
): SettingsScope | null {
  if (target === 'user') {
    return 'user'
  }

  if (target === 'workspace') {
    // 変えられない section・開いていない Workspace へは書かない（画面が押させない）。
    return canUseWorkspace ? 'workspace' : null
  }

  return canUseWorkspace && overriddenInWorkspace ? 'workspace' : 'user'
}

function applyEntries(
  state: ReadySettingsScopeState,
  section: SettingsSectionId,
  forUser: ReadonlyArray<readonly [string, unknown]>,
  forWorkspace: ReadonlyArray<readonly [string, unknown]>
): PlannedSettingsWrite {
  let next = state
  const requests: SaveSettingsSectionRequest[] = []

  if (forUser.length > 0) {
    const value = withEntries(readSection(state.user, section), forUser)

    next = { ...next, user: { ...next.user, [section]: value } }
    requests.push({ scope: 'user', ...toUpdate(section, value) })
  }

  if (forWorkspace.length > 0 && next.workspace !== null) {
    const workspace = next.workspace
    const value = withEntries(readSection(workspace.sections, section), forWorkspace)

    next = {
      ...next,
      workspace: { ...workspace, sections: { ...workspace.sections, [section]: value } }
    }
    requests.push({
      scope: 'workspace',
      workspaceId: workspace.workspaceId,
      ...toUpdate(section, value)
    })
  }

  return { next, requests }
}

function readSection(
  sections: SettingsSections | undefined,
  section: SettingsSectionId
): Readonly<Record<string, unknown>> {
  return (sections?.[section] ?? {}) as Readonly<Record<string, unknown>>
}

/** `undefined` の値は「その key を消す」として扱う。 */
function withEntries(
  base: Readonly<Record<string, unknown>>,
  entries: ReadonlyArray<readonly [string, unknown]>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const [key, value] of entries) {
    if (value === undefined) {
      delete result[key]
    } else {
      result[key] = value
    }
  }

  return result
}

function changedEntries(before: object, after: object): Array<readonly [string, unknown]> {
  const left = before as Readonly<Record<string, unknown>>
  const right = after as Readonly<Record<string, unknown>>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])

  return [...keys]
    .filter((key) => !Object.is(left[key], right[key]))
    .map((key) => [key, right[key]] as const)
}

/**
 * section 名で型が決まるユニオン（SettingsSectionUpdate）を組み立てる。
 *
 * 中身は `toStored` の出力を key 単位で差し替えたもので、形そのものは
 * binding の型が保証している。
 */
function toUpdate(
  section: SettingsSectionId,
  value: Record<string, unknown>
): SettingsSectionUpdate {
  return { section, value } as SettingsSectionUpdate
}
