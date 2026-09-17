import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createKeybindingsStore, KEYBINDINGS_FILE_NAME } from './keybindingsStore'

/**
 * `keybindings.json` の読み書き（Shortcuts S3）。
 *
 * settingsStore.test.ts と同じく、**実際のディスクを触る側の例外**にあたる。
 * 確かめたいのは、
 *
 *   - 無い / 壊れている / 読めるの区別
 *   - 壊れたファイルを**上書きする前に退避する**こと（利用者の手書きを消さない）
 *   - 一時ファイル経由で差し替わり、`.tmp` が残らないこと
 *
 * で、どれも写しのファイルシステムでは確かめられない。
 * 使うのは毎回作り直す一時フォルダで、userData には触れない。
 */

let directory: string
let issues: string[]

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'fx-keybindings-')))
  issues = []
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const FIXED_NOW = new Date(2026, 8, 17, 21, 30, 45)

function storeWith(): ReturnType<typeof createKeybindingsStore> {
  return createKeybindingsStore(directory, {
    onIssue: (message) => issues.push(message),
    now: () => FIXED_NOW
  })
}

const filePath = (): string => join(directory, KEYBINDINGS_FILE_NAME)

async function readStoredFile(): Promise<unknown> {
  return JSON.parse(await readFile(filePath(), 'utf8'))
}

describe('読み込み', () => {
  it('ファイルが無ければ missing（ファイルも作らない・ログも出さない）', async () => {
    const store = storeWith()

    expect(store.read()).toEqual({ status: 'missing', entries: [], skippedCount: 0 })
    store.flush()

    expect(await readdir(directory)).toEqual([])
    expect(issues).toEqual([])
  })

  it('読めるファイルは並び順のまま返し、形の合わない行を数える', async () => {
    await writeFile(
      filePath(),
      JSON.stringify([
        { key: 'ctrl+s', command: '-editor.save' },
        42,
        { key: 'ctrl+alt+s', command: 'editor.save' }
      ]),
      'utf8'
    )

    expect(storeWith().read()).toEqual({
      status: 'loaded',
      entries: [
        { key: 'ctrl+s', command: '-editor.save' },
        { key: 'ctrl+alt+s', command: 'editor.save' }
      ],
      skippedCount: 1
    })
    expect(issues).toHaveLength(1)
  })

  it.each([
    ['JSON として読めない', '[{ "key": "ctrl+s", '],
    ['配列でない', '{ "key": "ctrl+s", "command": "editor.save" }']
  ])('%s ファイルは unreadable（既定の割り当てで動く）', async (_label, text) => {
    await writeFile(filePath(), text, 'utf8')

    expect(storeWith().read()).toEqual({ status: 'unreadable', entries: [], skippedCount: 0 })
    expect(issues).toHaveLength(1)
  })

  it('2度目の読み込みはディスクを見ない（間引き中の保存と食い違わない）', async () => {
    const store = storeWith()
    store.save([{ key: 'ctrl+alt+s', command: 'editor.save' }])

    // まだ flush していない ── ディスクには何も無い。
    expect(store.read()).toEqual({
      status: 'loaded',
      entries: [{ key: 'ctrl+alt+s', command: 'editor.save' }],
      skippedCount: 0
    })
    store.flush()
  })
})

describe('保存', () => {
  it('丸ごと書き、.tmp を残さない', async () => {
    const store = storeWith()
    store.save([
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'ctrl+alt+s', command: 'editor.save' }
    ])
    store.flush()

    expect(await readStoredFile()).toEqual([
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'ctrl+alt+s', command: 'editor.save' }
    ])
    expect(await readdir(directory)).toEqual([KEYBINDINGS_FILE_NAME])
  })

  it('連続した保存は最後の1回になる', async () => {
    const store = storeWith()
    store.save([{ key: 'ctrl+1', command: 'editor.save' }])
    store.save([])
    store.flush()

    expect(await readStoredFile()).toEqual([])
  })

  it('次の起動で保存した内容が読める', () => {
    const first = storeWith()
    first.save([{ key: 'f6', command: 'debug.stepOver' }])
    first.flush()

    expect(storeWith().read()).toEqual({
      status: 'loaded',
      entries: [{ key: 'f6', command: 'debug.stepOver' }],
      skippedCount: 0
    })
  })

  it('壊れたファイルは、上書きする前に日時付きの名前で退避する', async () => {
    const broken = '[{ "key": "ctrl+s", "command": "editor.save" }, // 手で書いた\n]'
    await writeFile(filePath(), broken, 'utf8')

    const store = storeWith()
    expect(store.read().status).toBe('unreadable')

    store.save([{ key: 'ctrl+alt+s', command: 'editor.save' }])
    store.flush()

    const backupName = 'keybindings.broken-20260917-213045.json'
    expect((await readdir(directory)).sort()).toEqual([backupName, KEYBINDINGS_FILE_NAME].sort())
    // 退避したファイルは1文字も変わっていない。
    expect(await readFile(join(directory, backupName), 'utf8')).toBe(broken)
    expect(await readStoredFile()).toEqual([{ key: 'ctrl+alt+s', command: 'editor.save' }])
  })

  it('退避は最初の保存の1回だけ', async () => {
    await writeFile(filePath(), 'not json', 'utf8')

    const store = storeWith()
    store.save([{ key: 'ctrl+1', command: 'editor.save' }])
    store.flush()
    store.save([{ key: 'ctrl+2', command: 'editor.save' }])
    store.flush()

    const names = await readdir(directory)
    expect(names.filter((name) => name.startsWith('keybindings.broken-'))).toHaveLength(1)
    expect(await readStoredFile()).toEqual([{ key: 'ctrl+2', command: 'editor.save' }])
  })

  it('起動後に壊れたファイルが消されていても、そのまま保存できる', async () => {
    await writeFile(filePath(), 'not json', 'utf8')

    const store = storeWith()
    expect(store.read().status).toBe('unreadable')
    await rm(filePath())

    store.save([{ key: 'ctrl+1', command: 'editor.save' }])
    store.flush()

    expect(await readdir(directory)).toEqual([KEYBINDINGS_FILE_NAME])
  })
})
