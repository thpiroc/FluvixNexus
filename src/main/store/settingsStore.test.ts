import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SETTINGS_SCHEMA_VERSION } from '@shared/settings'
import { createSettingsStore, SETTINGS_FILE_NAME } from './settingsStore'

/**
 * `settings.json` の読み書きと、旧3ファイルからの取り込み（Session 4-3A）。
 *
 * `mutateWorkspaceEntry.test.ts` や `saveFileAs.test.ts` と同じく、**実際のディスクを
 * 触る側の例外**にあたる。確かめたいのは JSON の組み立て方ではなく、
 *
 *   - `settings.json` が**無いときだけ**旧3ファイルを読むこと
 *   - 取り込みが**一度きり**で終わること（2回目の起動では旧ファイルを見ない）
 *   - 一時ファイル経由で差し替わり、`.tmp` が残らないこと
 *   - 壊れたファイルでも、読める設定が生き残ること
 *
 * であり、どれも写しのファイルシステムでは確かめられない。
 *
 * 使うのは毎回作り直す一時フォルダで、**開発リポジトリにも userData にも触れない**
 * （保存先をフォルダで受け取る形にしてあるのは、まさにこれができるようにするため。
 * settingsStore.ts）。
 */

let directory: string

beforeEach(async () => {
  // realpath を通しておく。Windows の TEMP は短縮名（8.3）でありうる。
  directory = await realpath(await mkdtemp(join(tmpdir(), 'fx-settings-')))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** 書き込みは間引かれるため、確かめる前に必ず flush する。 */
function storeWith(): ReturnType<typeof createSettingsStore> {
  return createSettingsStore(directory)
}

async function readSettingsFile(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(directory, SETTINGS_FILE_NAME), 'utf8'))
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeFile(join(directory, fileName), JSON.stringify(value), 'utf8')
}

describe('settings.json の読み書き', () => {
  it('保存が無ければ、空の section で始まる（ファイルも作らない）', async () => {
    expect(storeWith().read()).toEqual({
      general: {},
      appearance: {},
      editor: {},
      lsp: {},
      files: {},
      terminal: {},
      mcp: {},
      security: {}
    })

    expect(await readdir(directory)).toEqual([])
  })

  it('保存した section が、次に開いたときに読める', async () => {
    const store = storeWith()
    store.saveSection({ section: 'terminal', value: { fontSize: 20, scrollback: 1000 } })
    store.flush()

    expect(storeWith().read().terminal).toEqual({ fontSize: 20, scrollback: 1000 })
  })

  it('一時ファイルを残さない（原子的な差し替え）', async () => {
    const store = storeWith()
    store.saveSection({ section: 'files', value: { viewMode: 'tree' } })
    store.flush()

    expect(await readdir(directory)).toEqual([SETTINGS_FILE_NAME])
  })

  it('書かれる形は schemaVersion + sections', async () => {
    const store = storeWith()
    store.saveSection({ section: 'editor', value: { autoSaveMode: 'afterDelay' } })
    store.flush()

    expect(await readSettingsFile()).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sections: {
        general: {},
        appearance: {},
        editor: { autoSaveMode: 'afterDelay' },
        lsp: {},
        files: {},
        terminal: {},
        mcp: {},
        security: {}
      }
    })
  })

  it('別の section を保存しても、先に保存した section は消えない', async () => {
    const store = storeWith()
    store.saveSection({ section: 'editor', value: { autoSaveMode: 'afterDelay' } })
    store.saveSection({ section: 'terminal', value: { fontSize: 20 } })
    store.flush()

    const sections = storeWith().read()

    expect(sections.editor).toEqual({ autoSaveMode: 'afterDelay' })
    expect(sections.terminal).toEqual({ fontSize: 20 })
  })

  it('一部が壊れていても、読める section は生き残る', async () => {
    await writeJson(SETTINGS_FILE_NAME, {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sections: {
        editor: 'broken',
        files: { viewMode: 'columns', columnWidth: 'wide' },
        terminal: { fontSize: 20, scrollback: 1000 }
      }
    })

    expect(storeWith().read()).toEqual({
      general: {},
      appearance: {},
      editor: {},
      lsp: {},
      files: { viewMode: 'columns' },
      terminal: { fontSize: 20, scrollback: 1000 },
      mcp: {},
      security: {}
    })
  })

  it('JSON として壊れていれば既定で始まる（旧ファイルへは戻らない。Security だけは read）', async () => {
    await writeFile(join(directory, SETTINGS_FILE_NAME), '{ not json', 'utf8')
    await writeJson('terminal-settings.json', {
      schemaVersion: 1,
      display: { fontSize: 20, scrollback: 1000 }
    })

    expect(storeWith().read()).toEqual({
      general: {},
      appearance: {},
      editor: {},
      lsp: {},
      files: {},
      terminal: {},
      mcp: {},
      // 在るのに読めないファイル。Security は既定（ask）へ緩めず read で始める。
      security: { permissionMode: 'read' }
    })
  })
})

/**
 * 撤去した key の掃除（旧 Notion MCP の `mcp.notionEnabled`）。
 *
 * 読んだ時点で落とし、利用者が何も保存しなくてもその場で1度だけ書き直す。
 * ほかの設定は1つも変えず、2回目の起動では書かない。
 */
describe('撤去した key の掃除', () => {
  const legacyFile = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    futureTopLevel: { kept: true },
    sections: {
      general: { language: 'en' },
      editor: { autoSaveMode: 'afterDelay', minimap: true },
      terminal: { fontSize: 20 },
      mcp: { enabled: true, notionEnabled: true }
    }
  }

  it('読み込んだ時点で mcp.notionEnabled をファイルから消し、ほかは変えない', async () => {
    await writeJson(SETTINGS_FILE_NAME, legacyFile)
    const issues: string[] = []

    const sections = createSettingsStore(directory, {
      onIssue: (message) => issues.push(message)
    }).read()

    expect(sections.mcp).toEqual({ enabled: true })
    expect(sections.general).toEqual({ language: 'en' })
    expect(sections.terminal).toEqual({ fontSize: 20 })
    expect(issues).toContain(`"${SETTINGS_FILE_NAME}": removed retired "mcp.notionEnabled"`)

    /* flush を呼ばなくても、もうファイルに無い。 */
    expect(await readSettingsFile()).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      futureTopLevel: { kept: true },
      sections: {
        general: { language: 'en' },
        appearance: {},
        editor: { autoSaveMode: 'afterDelay', minimap: true },
        lsp: {},
        files: {},
        terminal: { fontSize: 20 },
        mcp: { enabled: true },
        security: {}
      }
    })
  })

  it('2回目の起動では書き直さない（何度起動しても同じ）', async () => {
    await writeJson(SETTINGS_FILE_NAME, legacyFile)
    storeWith().read()
    const afterFirst = await readFile(join(directory, SETTINGS_FILE_NAME), 'utf8')

    const issues: string[] = []
    createSettingsStore(directory, { onIssue: (message) => issues.push(message) }).read()

    expect(issues).toEqual([])
    expect(await readFile(join(directory, SETTINGS_FILE_NAME), 'utf8')).toBe(afterFirst)
  })

  it('撤去した key が無ければ、読むだけで書かない', async () => {
    const content = JSON.stringify({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sections: { mcp: { enabled: false } }
    })
    await writeFile(join(directory, SETTINGS_FILE_NAME), content, 'utf8')

    storeWith().read()

    expect(await readFile(join(directory, SETTINGS_FILE_NAME), 'utf8')).toBe(content)
  })
})

/**
 * 旧3ファイルからの取り込み。
 *
 * `settings.json` が**無いときだけ**通る道で、取り込めたらその場で1度書く。
 * 旧ファイルは消さない（戻れる道を残す。legacySettings.ts）。
 */
describe('旧 3 ファイルからの移行', () => {
  const editorFile = { schemaVersion: 1, autoSave: { mode: 'afterDelay', delayMs: 3000 } }
  const filesFile = { schemaVersion: 1, view: { mode: 'columns', columnWidth: 240 } }
  const terminalFile = { schemaVersion: 1, display: { fontSize: 20, scrollback: 1000 } }

  async function writeLegacy(): Promise<void> {
    await writeJson('editor-settings.json', editorFile)
    await writeJson('files-settings.json', filesFile)
    await writeJson('terminal-settings.json', terminalFile)
  }

  it('旧3ファイルを読み、settings.json へ1度で書く', async () => {
    await writeLegacy()

    expect(storeWith().read()).toEqual({
      general: {},
      appearance: {},
      editor: { autoSaveMode: 'afterDelay', autoSaveDelayMs: 3000 },
      lsp: {},
      files: { viewMode: 'columns', columnWidth: 240 },
      terminal: { fontSize: 20, scrollback: 1000 },
      mcp: {},
      security: {}
    })

    // 読んだだけで（保存を1度もせずに）ファイルができている。
    expect(await readSettingsFile()).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sections: {
        general: {},
        appearance: {},
        editor: { autoSaveMode: 'afterDelay', autoSaveDelayMs: 3000 },
        lsp: {},
        files: { viewMode: 'columns', columnWidth: 240 },
        terminal: { fontSize: 20, scrollback: 1000 },
        mcp: {},
        security: {}
      }
    })
  })

  it('旧ファイルは消さない（戻れる道を残す）', async () => {
    await writeLegacy()
    storeWith().read()

    expect((await readdir(directory)).sort()).toEqual([
      'editor-settings.json',
      'files-settings.json',
      SETTINGS_FILE_NAME,
      'terminal-settings.json'
    ])
  })

  it('1つが壊れていても、他の2つは移る', async () => {
    await writeLegacy()
    await writeFile(join(directory, 'files-settings.json'), '{ broken', 'utf8')

    const sections = storeWith().read()

    expect(sections.files).toEqual({})
    expect(sections.editor).toEqual({ autoSaveMode: 'afterDelay', autoSaveDelayMs: 3000 })
    expect(sections.terminal).toEqual({ fontSize: 20, scrollback: 1000 })
  })

  it('一部のファイルしか無くても移る', async () => {
    await writeJson('terminal-settings.json', terminalFile)

    expect(storeWith().read()).toEqual({
      general: {},
      appearance: {},
      editor: {},
      lsp: {},
      files: {},
      terminal: { fontSize: 20, scrollback: 1000 },
      mcp: {},
      security: {}
    })
  })

  /* 2回目以降の起動。**settings.json が優先され、旧ファイルはもう読まない。** */
  it('settings.json があれば、旧ファイルは読まない', async () => {
    await writeLegacy()
    await writeJson(SETTINGS_FILE_NAME, {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sections: { terminal: { fontSize: 11 } }
    })

    expect(storeWith().read()).toEqual({
      general: {},
      appearance: {},
      editor: {},
      lsp: {},
      files: {},
      terminal: { fontSize: 11 },
      mcp: {},
      security: {}
    })
  })

  it('移行を繰り返さない（移行後に変えた設定が旧ファイルで戻らない）', async () => {
    await writeLegacy()

    const first = storeWith()
    first.read()
    first.saveSection({ section: 'terminal', value: { fontSize: 11 } })
    first.flush()

    expect(storeWith().read().terminal).toEqual({ fontSize: 11 })
  })

  it('旧ファイルが1つも無ければ、何も書かない', async () => {
    expect(storeWith().read()).toEqual({
      general: {},
      appearance: {},
      editor: {},
      lsp: {},
      files: {},
      terminal: {},
      mcp: {},
      security: {}
    })

    expect(await readdir(directory)).toEqual([])
  })
})
