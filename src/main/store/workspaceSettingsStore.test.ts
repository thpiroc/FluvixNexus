import { mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WORKSPACE_SETTINGS_MAX_WORKSPACES } from './workspaceSettingsDocument'
import {
  createWorkspaceSettingsStore,
  WORKSPACE_SETTINGS_FILE_NAME
} from './workspaceSettingsStore'

/**
 * `workspace-settings.json` の読み書き（feature/settings-scope）。
 *
 * settingsStore.test.ts と同じく**実際のディスク**で確かめる。見たいのは、
 *
 *   - ストアを作り直しても（＝再起動しても）Workspace ごとの値が残ること
 *   - Workspace A の値が B に混ざらないこと
 *   - key を消せば、その Workspace の上書きが無くなること
 *   - 壊れた / 知らない内容でも、読める分だけ読むこと
 *
 * 使うのは毎回作り直す一時フォルダで、userData にも Workspace の中にも触れない。
 */

const WORKSPACE_A = 'D:\\work\\project-a'
const WORKSPACE_B = 'D:\\work\\project-b'

let directory: string

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'fx-workspace-settings-')))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function readSettingsFile(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(directory, WORKSPACE_SETTINGS_FILE_NAME), 'utf8'))
}

describe('workspace-settings.json の読み書き', () => {
  it('保存が無ければ、どの Workspace も空で始まる（ファイルも作らない）', async () => {
    const store = createWorkspaceSettingsStore(directory)

    expect(store.read(WORKSPACE_A).terminal).toEqual({})
    store.flush()
    await expect(readFile(join(directory, WORKSPACE_SETTINGS_FILE_NAME))).rejects.toThrow()
  })

  it('保存した値は、ストアを作り直しても（再起動しても）残る', () => {
    const first = createWorkspaceSettingsStore(directory)

    first.saveSection(WORKSPACE_A, { section: 'terminal', value: { fontSize: 20 } })
    first.saveSection(WORKSPACE_A, { section: 'appearance', value: { theme: 'light' } })
    first.flush()

    const second = createWorkspaceSettingsStore(directory)

    expect(second.read(WORKSPACE_A).terminal).toEqual({ fontSize: 20 })
    expect(second.read(WORKSPACE_A).appearance).toEqual({ theme: 'light' })
  })

  it('Workspace A の値は B に混ざらない', () => {
    const store = createWorkspaceSettingsStore(directory)

    store.saveSection(WORKSPACE_A, { section: 'terminal', value: { fontSize: 20 } })
    store.saveSection(WORKSPACE_B, { section: 'editor', value: { autoSaveMode: 'afterDelay' } })
    store.flush()

    const reopened = createWorkspaceSettingsStore(directory)

    expect(reopened.read(WORKSPACE_A).terminal).toEqual({ fontSize: 20 })
    expect(reopened.read(WORKSPACE_A).editor).toEqual({})
    expect(reopened.read(WORKSPACE_B).terminal).toEqual({})
    expect(reopened.read(WORKSPACE_B).editor).toEqual({ autoSaveMode: 'afterDelay' })
  })

  it('key を消して保存すると、その上書きが無くなる（ユーザー設定へ戻る）', () => {
    const store = createWorkspaceSettingsStore(directory)

    store.saveSection(WORKSPACE_A, {
      section: 'terminal',
      value: { fontSize: 20, scrollback: 900 }
    })
    store.saveSection(WORKSPACE_A, { section: 'terminal', value: { scrollback: 900 } })
    store.flush()

    expect(createWorkspaceSettingsStore(directory).read(WORKSPACE_A).terminal).toEqual({
      scrollback: 900
    })
  })

  it('ファイルの形は settings.json と同じ欄を Workspace ごとに持つ', async () => {
    const store = createWorkspaceSettingsStore(directory, { now: () => 1234 })

    store.saveSection(WORKSPACE_A, { section: 'terminal', value: { fontSize: 20 } })
    store.flush()

    const saved = await readSettingsFile()

    expect(saved.schemaVersion).toBe(1)
    expect((saved.workspaces as Record<string, unknown>)[WORKSPACE_A]).toEqual({
      schemaVersion: 1,
      updatedAt: 1234,
      sections: {
        general: {},
        appearance: {},
        editor: {},
        lsp: {},
        files: {},
        terminal: { fontSize: 20 },
        mcp: {},
        security: {}
      }
    })
  })

  it('壊れた key は落とし、読める key と知らない内容は残す', async () => {
    await writeFile(
      join(directory, WORKSPACE_SETTINGS_FILE_NAME),
      JSON.stringify({
        schemaVersion: 1,
        futureTopLevel: { keep: true },
        workspaces: {
          [WORKSPACE_A]: {
            schemaVersion: 1,
            updatedAt: 10,
            sections: {
              terminal: { fontSize: 'huge', scrollback: 700, futureKey: 1 },
              futureSection: { x: 1 }
            }
          },
          [WORKSPACE_B]: 'not an object'
        }
      }),
      'utf8'
    )

    const issues: string[] = []
    const store = createWorkspaceSettingsStore(directory, { onIssue: (m) => issues.push(m) })

    expect(store.read(WORKSPACE_A).terminal).toEqual({ scrollback: 700 })
    expect(store.read(WORKSPACE_B).terminal).toEqual({})
    expect(issues.length).toBeGreaterThan(0)

    // 何か1つ書くと、知らない内容はそのまま書き戻される。
    store.saveSection(WORKSPACE_A, { section: 'editor', value: { autoSaveMode: 'off' } })
    store.flush()

    const saved = await readSettingsFile()
    const entry = (saved.workspaces as Record<string, Record<string, unknown>>)[WORKSPACE_A]

    expect(saved.futureTopLevel).toEqual({ keep: true })
    expect((entry.sections as Record<string, unknown>).futureSection).toEqual({ x: 1 })
    expect((entry.sections as Record<string, unknown>).terminal).toEqual({
      futureKey: 1,
      scrollback: 700
    })
  })

  it('JSON として読めなければ、空で始める（落ちない）', async () => {
    await writeFile(join(directory, WORKSPACE_SETTINGS_FILE_NAME), '{ not json', 'utf8')

    const store = createWorkspaceSettingsStore(directory, { onIssue: () => {} })

    expect(store.read(WORKSPACE_A).terminal).toEqual({})
  })

  it('上限を超えたら、最後に変えたのが最も古い Workspace から落とす', () => {
    let clock = 0
    const store = createWorkspaceSettingsStore(directory, { now: () => ++clock })

    for (let index = 0; index <= WORKSPACE_SETTINGS_MAX_WORKSPACES; index += 1) {
      store.saveSection(`D:\\work\\p${index}`, { section: 'terminal', value: { fontSize: 14 } })
    }
    store.flush()

    const reopened = createWorkspaceSettingsStore(directory)

    expect(reopened.read('D:\\work\\p0').terminal).toEqual({})
    expect(reopened.read(`D:\\work\\p${WORKSPACE_SETTINGS_MAX_WORKSPACES}`).terminal).toEqual({
      fontSize: 14
    })
  })
})
