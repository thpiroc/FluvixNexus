import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyWorkspaceEntry } from './mutateWorkspaceEntry'

/**
 * 「再帰コピーが途中で止まったとき、何が残り、何が返るか」の検証。
 *
 * ## ここだけ失敗を注文して作る
 *
 * 途中で止まる状況（権限・使用中・容量）は実物のディスクでは作れず、作れたとしても
 * OS と実行ユーザーに左右される。**確かめたいのは失敗の作り方ではなく、
 * 失敗した後の振る舞い**なので、再帰の部分だけを差し替えて
 * 「止まった」を注文する（mutateWorkspaceEntry.test.ts が
 * `shell.trashItem` の失敗に対してやっているのと同じ形）。
 *
 * 差し替えていない部分 ── コピー先の1階層目を作るところ、その結果を返すところ、
 * **作りかけを消しに行かないこと** ── は実物のディスクで確かめる。
 *
 * mutateWorkspaceEntry.test.ts と別のファイルにしてあるのは、モジュールの
 * 差し替えがファイル単位で効くため。あちらは同じ再帰を実物で確かめており、
 * 同居させるとどちらかが写しを相手にすることになる。
 */

const { failure } = vi.hoisted(() => ({
  failure: {
    /** libuv が付ける errno（OS に依らない）。ここを変えると分類の翻訳を確かめられる。 */
    code: 'EACCES' as string,
    skippedCount: 2
  }
}))

vi.mock('./copyTree', () => ({
  copyDirectoryContents: async () => ({
    status: 'failed',
    skippedCount: failure.skippedCount,
    cause: Object.assign(new Error('permission denied'), { code: failure.code })
  })
}))

/** deleteWorkspaceEntry を通らないので実体は要らないが、import は解決する必要がある。 */
vi.mock('electron', () => ({ shell: { trashItem: async (): Promise<void> => undefined } }))

let root: string

beforeEach(async () => {
  failure.code = 'EACCES'
  failure.skippedCount = 2

  root = join(await realpath(await mkdtemp(join(tmpdir(), 'fx-copy-partial-'))), 'workspace')

  await mkdir(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'main.ts'), 'x')
  await mkdir(join(root, 'dest'))
})

afterEach(async () => {
  await rm(join(root, '..'), { recursive: true, force: true }).catch(() => undefined)
})

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

describe('copyWorkspaceEntry（途中で止まった場合）', () => {
  it('partial として返し、何ができかけているかも伝える', async () => {
    expect(await copyWorkspaceEntry(root, 'src', 'dest')).toMatchObject({
      status: 'partial',
      skippedCount: 2,
      entry: { relativePath: 'dest/src', type: 'directory' },
      failure: { status: 'permission-denied' }
    })
  })

  /*
    **作りかけを消しに行かない。** 消すには fs.rm が要り、Renderer から届いた要求で
    戻せない削除が起きる経路を1つ増やすことになる（ARCHITECTURE.md §10.2）。
    残ったものはツリーに現れる（`created` は配る）ので、利用者が見て消せる。
  */
  it('できかけたものはコピー先に残る（片付けない）', async () => {
    await copyWorkspaceEntry(root, 'src', 'dest')

    expect(await exists(join(root, 'dest', 'src'))).toBe(true)
    // 元にも手を付けていない。
    expect(await exists(join(root, 'src', 'main.ts'))).toBe(true)
  })

  it('止めた理由の分類はそのまま持ち上がる', async () => {
    failure.code = 'EBUSY'

    expect(await copyWorkspaceEntry(root, 'src', 'dest')).toMatchObject({
      status: 'partial',
      failure: { status: 'busy' }
    })
  })

  /*
    名前の決め方（衝突したら次の候補へ）は止まる前に済んでいる。
    途中で止まっても、できかけたものの位置は正しく伝わる必要がある
    ── そこを消すのは利用者だから。
  */
  it('同名を避けた名前で作りかけていれば、その位置が返る', async () => {
    await mkdir(join(root, 'dest', 'src'))

    expect(await copyWorkspaceEntry(root, 'src', 'dest')).toMatchObject({
      status: 'partial',
      entry: { relativePath: 'dest/src copy' }
    })

    expect(await exists(join(root, 'dest', 'src copy'))).toBe(true)
  })

  /* ファイル1件のコピーは1回の fs 操作で終わるため、途中で止まる形が無い。 */
  it('ファイルのコピーは partial にならない', async () => {
    expect(await copyWorkspaceEntry(root, 'src/main.ts', 'dest')).toMatchObject({
      status: 'ok',
      skippedCount: 0
    })
  })
})
