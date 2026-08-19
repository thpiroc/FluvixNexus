import { rmSync } from 'fs'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWindows } from '../platform'
import { searchWorkspaceFiles, type SearchWorkspaceFilesOutcome } from './searchWorkspaceFiles'

/**
 * プロジェクト全体検索（走査＋ファイル名検索）の検証（Session 3-6-4）。
 *
 * copyTree.test.ts / mutateWorkspaceEntry.test.ts と同じく**実際のディスクを触る。**
 * 確かめたいことの多く（リンクを辿らないか・除外が効くか・深さで止まるか）は、
 * 写しの fs では何も確かめられない性質のものにあたる。
 *
 * Workspace の話（どの Workspace か・Renderer へ何を返すか）はここには出てこない。
 * この層が持つのは「root から下をどう歩くか」だけで、
 * 基点を決めるのも結末を翻訳するのも ipc/handlers/files.ts の仕事になる。
 */

let root: string
/** Workspace の外。リンクを辿っていないことを、中身が来ないことで確かめる。 */
let outside: string

beforeEach(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'fx-search-')))

  root = join(base, 'workspace')
  outside = join(base, 'outside')

  await mkdir(root)
  await mkdir(outside)
  await writeFile(join(outside, 'secret-target.txt'), 'secret')
})

afterEach(async () => {
  await rm(join(root, '..'), { recursive: true, force: true }).catch(() => undefined)
})

/** 見つかった相対位置の一覧（並びも含めて確かめられる形）。 */
function pathsOf(outcome: SearchWorkspaceFilesOutcome): readonly string[] {
  return outcome.status === 'ok' ? outcome.matches.map((match) => match.relativePath) : []
}

/**
 * Windows のジャンクションは管理者権限なしで作れる。作れない環境では飛ばす
 * （作れないことを失敗として報告しても直しようがない）。
 */
async function tryLink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, isWindows ? 'junction' : 'dir')
    return true
  } catch {
    return false
  }
}

describe('通常の検索', () => {
  it('名前の部分一致で見つける', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'workspacePath.ts'), '')
    await writeFile(join(root, 'src', 'index.ts'), '')
    await writeFile(join(root, 'README.md'), '')

    const outcome = await searchWorkspaceFiles(root, 'path')

    expect(outcome).toMatchObject({
      status: 'ok',
      completion: 'completed',
      truncated: false,
      limit: null
    })
    expect(pathsOf(outcome)).toEqual(['src/workspacePath.ts'])
  })

  it('大文字 / 小文字を区別しない', async () => {
    await writeFile(join(root, 'README.md'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'readme'))).toEqual(['README.md'])
    expect(pathsOf(await searchWorkspaceFiles(root, 'ReAdMe'))).toEqual(['README.md'])
  })

  it('フォルダも結果に出る（種別が付く）', async () => {
    await mkdir(join(root, 'searchable'))
    await writeFile(join(root, 'searchable.txt'), '')

    const outcome = await searchWorkspaceFiles(root, 'searchable')

    expect(outcome.status === 'ok' && outcome.matches).toMatchObject([
      { relativePath: 'searchable', name: 'searchable', type: 'directory' },
      { relativePath: 'searchable.txt', name: 'searchable.txt', type: 'file' }
    ])
  })

  it('一致が無ければ 0 件（失敗ではない）', async () => {
    await writeFile(join(root, 'README.md'), '')

    const outcome = await searchWorkspaceFiles(root, 'terminal')

    expect(outcome).toMatchObject({ status: 'ok', completion: 'completed', matches: [] })
  })

  it('空の検索語は受け付けない（全件の列挙になるため）', async () => {
    await writeFile(join(root, 'README.md'), '')

    expect(await searchWorkspaceFiles(root, '')).toEqual({ status: 'invalid-query' })
    expect(await searchWorkspaceFiles(root, undefined)).toEqual({ status: 'invalid-query' })
    expect(await searchWorkspaceFiles(root, 'x'.repeat(256))).toEqual({ status: 'invalid-query' })
  })

  /* 浅い場所ほど先に出す（幅優先）。件数で打ち切っても近い場所が消えない。 */
  it('浅い場所から順に返る', async () => {
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'target.txt'), '')
    await writeFile(join(root, 'a', 'target.txt'), '')
    await writeFile(join(root, 'a', 'b', 'target.txt'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'target'))).toEqual([
      'target.txt',
      'a/target.txt',
      'a/b/target.txt'
    ])
  })

  it('同じ階層ではフォルダが先・名前順', async () => {
    await writeFile(join(root, 'hit-b.txt'), '')
    await writeFile(join(root, 'hit-a.txt'), '')
    await mkdir(join(root, 'hit-dir'))

    expect(pathsOf(await searchWorkspaceFiles(root, 'hit'))).toEqual([
      'hit-dir',
      'hit-a.txt',
      'hit-b.txt'
    ])
  })
})

describe('深い階層', () => {
  it('深い場所にあるものも見つかる', async () => {
    await mkdir(join(root, 'a', 'b', 'c', 'd', 'e'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'c', 'd', 'e', 'deep.txt'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'deep'))).toEqual(['a/b/c/d/e/deep.txt'])
  })

  it('深さの上限より下へは潜らない（打ち切りとして伝える）', async () => {
    await mkdir(join(root, 'a', 'b', 'c'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'shallow.txt'), '')
    await writeFile(join(root, 'a', 'b', 'c', 'deep.txt'), '')

    const outcome = await searchWorkspaceFiles(root, '.txt', { maxDepth: 2 })

    expect(pathsOf(outcome)).toEqual(['a/b/shallow.txt'])
    expect(outcome).toMatchObject({ truncated: true, limit: 'depth' })
  })
})

describe('上限', () => {
  it('件数で打ち切る', async () => {
    for (let index = 0; index < 20; index += 1) {
      await writeFile(join(root, `hit-${index}.txt`), '')
    }

    const outcome = await searchWorkspaceFiles(root, 'hit', { maxResults: 5 })

    expect(outcome.status === 'ok' && outcome.matches.length).toBe(5)
    expect(outcome).toMatchObject({ truncated: true, limit: 'results' })
  })

  it('大量のファイルでも走査数で打ち切る', async () => {
    await mkdir(join(root, 'many'))

    for (let index = 0; index < 300; index += 1) {
      await writeFile(join(root, 'many', `file-${index}.txt`), '')
    }

    const outcome = await searchWorkspaceFiles(root, 'file-2', { maxScannedEntries: 50 })

    expect(outcome).toMatchObject({ truncated: true, limit: 'scanned' })
    expect(outcome.status === 'ok' && outcome.scannedCount).toBe(50)
  })

  /*
    件数だけでは足りない（0 件でも数十万件を舐めうる）。
    時間の進み方はテストから差し替える ── 実時間に依存させると、
    速いマシンでは通り遅いマシンでは落ちるテストになる。
  */
  it('時間で打ち切る', async () => {
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'target.txt'), '')

    let clock = 0

    const outcome = await searchWorkspaceFiles(root, 'target', {
      timeBudgetMs: 10,
      now: () => {
        clock += 8
        return clock
      }
    })

    expect(outcome).toMatchObject({ truncated: true, limit: 'time', matches: [] })
  })

  it('上限に当たらなければ truncated は false', async () => {
    await writeFile(join(root, 'hit.txt'), '')

    expect(await searchWorkspaceFiles(root, 'hit')).toMatchObject({
      truncated: false,
      limit: null
    })
  })
})

describe('除外するフォルダ', () => {
  /* 監視と同じ規則を共有している（ignoredDirectories.ts）。 */
  it('.git / node_modules の中は探さない', async () => {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, '.git', 'config.txt'), '')
    await writeFile(join(root, 'node_modules', 'pkg', 'config.txt'), '')
    await writeFile(join(root, 'config.txt'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'config'))).toEqual(['config.txt'])
  })

  it('深い場所の node_modules も外す', async () => {
    await mkdir(join(root, 'packages', 'app', 'node_modules'), { recursive: true })
    await writeFile(join(root, 'packages', 'app', 'node_modules', 'target.txt'), '')
    await writeFile(join(root, 'packages', 'app', 'target.txt'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'target'))).toEqual(['packages/app/target.txt'])
  })

  /* 外したいのは「中に数万件を抱えるフォルダ」であって、名前そのものではない。 */
  it('同じ名前のファイルは普通に見つかる', async () => {
    await writeFile(join(root, 'node_modules'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'node_modules'))).toEqual(['node_modules'])
  })
})

describe('名前の形', () => {
  it('空白・記号・括弧を含む名前も字義どおり探せる', async () => {
    await writeFile(join(root, 'my report (final).txt'), '')
    await writeFile(join(root, 'a+b[c].txt'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, ' (final)'))).toEqual(['my report (final).txt'])
    expect(pathsOf(await searchWorkspaceFiles(root, '+b[c]'))).toEqual(['a+b[c].txt'])
  })

  it('日本語の名前も探せる', async () => {
    await writeFile(join(root, '設計メモ.md'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'メモ'))).toEqual(['設計メモ.md'])
  })

  it('長い名前も見つかる', async () => {
    const longName = `${'n'.repeat(200)}.txt`

    await writeFile(join(root, longName), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'nnn'))).toEqual([longName])
  })

  /*
    契約上の上限（FILES_RELATIVE_PATH_MAX_LENGTH = 1024）を超える位置は返さない。
    Renderer が扱えず、そこから開こうとしても Main 側の検証で断られる。
  */
  it('相対位置が長すぎるものは返さない', async () => {
    let current = root

    // 100 文字のフォルダを 12 段（＝ 1200 文字あまり）。
    for (let depth = 0; depth < 12; depth += 1) {
      current = join(current, 'd'.repeat(100))
      await mkdir(current)
    }

    await writeFile(join(current, 'target.txt'), '')
    await writeFile(join(root, 'target.txt'), '')

    expect(pathsOf(await searchWorkspaceFiles(root, 'target.txt'))).toEqual(['target.txt'])
  })
})

describe('リンク（symlink / ジャンクション）', () => {
  it('中へは潜らない（Workspace の外の中身が結果に出ない）', async ({ skip }) => {
    if (!(await tryLink(outside, join(root, 'link')))) {
      skip()
    }

    await writeFile(join(root, 'secret-inside.txt'), '')

    const outcome = await searchWorkspaceFiles(root, 'secret')

    // 中（outside/secret-target.txt）は出てこない。Workspace の中のものだけが出る。
    expect(pathsOf(outcome)).toEqual(['secret-inside.txt'])
  })

  /* そこに在るものではあるので、リンクそのものは1件として出す。 */
  it('リンクそのものは結果に出る', async ({ skip }) => {
    if (!(await tryLink(outside, join(root, 'linked-folder')))) {
      skip()
    }

    const outcome = await searchWorkspaceFiles(root, 'linked')

    expect(pathsOf(outcome)).toEqual(['linked-folder'])
    // 種別は指し先を見て決める（列挙と同じ判断。linkEntryType.ts）。
    expect(outcome.status === 'ok' && outcome.matches[0]?.type).toBe('directory')
  })

  /* リンクを辿らない以上、リンクの輪でも走査は必ず終わる。 */
  it('自分を指すリンクがあっても終わる', async ({ skip }) => {
    await mkdir(join(root, 'inner'))

    if (!(await tryLink(root, join(root, 'inner', 'loop')))) {
      skip()
    }

    await writeFile(join(root, 'target.txt'), '')

    const outcome = await searchWorkspaceFiles(root, 'target')

    expect(outcome).toMatchObject({ status: 'ok', completion: 'completed' })
    expect(pathsOf(outcome)).toEqual(['target.txt'])
  })
})

describe('取り消し', () => {
  it('取り消されていれば途中で止まる', async () => {
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'target.txt'), '')

    const outcome = await searchWorkspaceFiles(root, 'target', {
      cancellation: { cancelled: true }
    })

    expect(outcome).toMatchObject({ status: 'ok', completion: 'cancelled', matches: [] })
  })

  /*
    走っている途中で取り消される形。1つ目のフォルダを読んだ後に立てる。
    **見つけたぶんは返る**（利用者が自分で止めた場合、その時点の結果が残る）。
  */
  it('走っている途中で取り消すと、そこまでの結果が返る', async () => {
    await writeFile(join(root, 'target-top.txt'), '')
    await mkdir(join(root, 'deeper'))
    await writeFile(join(root, 'deeper', 'target-deep.txt'), '')

    const cancellation = { cancelled: false }
    let ticks = 0

    const outcome = await searchWorkspaceFiles(root, 'target', {
      now: () => {
        ticks += 1

        // root を読み終えたところで取り消す。
        if (ticks > 2) {
          cancellation.cancelled = true
        }

        return 0
      },
      cancellation
    })

    expect(outcome).toMatchObject({ status: 'ok', completion: 'cancelled' })
    expect(pathsOf(outcome)).toEqual(['target-top.txt'])
  })
})

describe('root の失敗', () => {
  it('Workspace root が無ければ not-found', async () => {
    await rm(root, { recursive: true, force: true })

    expect(await searchWorkspaceFiles(root, 'target')).toEqual({ status: 'not-found' })
  })

  /*
    途中の1フォルダが読めないことで検索全体を止めない。

    「読もうとした時点で消えている」を確実に作るため、走査の合間（now が呼ばれる
    タイミング）に同期で消す。root を読み終えてから `gone` を読むまでの間にあたる。
  */
  it('読めないフォルダがあっても、他の場所は探せる', async () => {
    await mkdir(join(root, 'gone'))
    await writeFile(join(root, 'target.txt'), '')

    let ticks = 0

    const outcome = await searchWorkspaceFiles(root, 'target', {
      now: () => {
        ticks += 1

        if (ticks > 2) {
          rmSync(join(root, 'gone'), { recursive: true, force: true })
        }

        return 0
      }
    })

    expect(outcome).toMatchObject({ status: 'ok', completion: 'completed' })
    expect(pathsOf(outcome)).toEqual(['target.txt'])
  })
})
