import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GitRepositoryState } from '@shared/git'
import type { AgentPermissionMode } from '@shared/security'
import { readWorkspaceDirectory } from '../../files/readWorkspaceDirectory'
import { searchWorkspaceFileContents } from '../../files/searchWorkspaceFileContents'
import { runAgentTool, type AgentToolbox } from '../../agent/agentTools'
import { isWindows } from '../../platform'
import type { AuditEvent } from '../audit/auditEvent'
import { resolveWorkspaceTarget } from '../boundary/workspaceBoundary'
import { decideExternalSend } from '../externalSend/externalSendDecision'
import { SECRET_MASK } from '../secret/secretMasking'
import {
  createReadToolsGate,
  READ_TOOL_MAX_LINES,
  type ReadToolsDependencies,
  type ReadToolsGate
} from './readToolsGate'
import {
  confirmPinnedWorkspaceRoot,
  listPinnedWorkspaceDirectory,
  readVerifiedFileBytes,
  resolvePinnedWorkspaceTarget
} from './readToolsIo'

/**
 * Read Tool Gate（Security Core v1 の STEP9）。
 *
 * Boundary（STEP2）・Secret（STEP3）・Policy（STEP1）・読み取り（readToolsIo.ts）・
 * Files の一覧と検索は**本物を通す**。「Read だから無制限に読める」ではないことを、
 * 実際のディスクに対して確かめる。
 */

const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'
const PRIVATE_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAv0Hh8kQfQ2mZabcdefghijklmnopqrstuvwxyzABCD',
  '-----END RSA PRIVATE KEY-----'
].join('\n')

let base: string
let root: string
let events: AuditEvent[]
let mode: AgentPermissionMode
let git: GitRepositoryState

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-read-tools-')))
  root = join(base, 'workspace')

  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, '.ssh'), { recursive: true })
  await writeFile(join(base, 'outside.txt'), `outside ${TOKEN}\n`)
  await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n// TODO: fix\n')
  await writeFile(join(root, 'src', 'config.ts'), `const token = "${TOKEN}"\n// TODO: rotate\n`)
  await writeFile(join(root, 'src', 'key.ts'), `// TODO: remove\n${PRIVATE_KEY}\n`)
  await writeFile(join(root, '.env'), 'API_KEY=A1b2C3d4E5f6G7h8 TODO\n')
  await writeFile(join(root, '.ssh', 'config'), 'Host TODO\n')
  await writeFile(join(root, 'binary.bin'), Buffer.from([0x54, 0x00, 0x4f, 0x00]))
  await writeFile(
    join(root, 'long.txt'),
    Array.from({ length: 1000 }, (_, index) => `line ${index + 1}`).join('\n')
  )

  events = []
  mode = 'ask'
  git = {
    status: 'ready',
    head: { kind: 'branch', name: 'feature/x' },
    changes: {
      staged: [change('src/app.ts')],
      unstaged: [change('.env'), change('src/app.ts')],
      untracked: [change('notes.md')],
      conflicted: []
    },
    upstream: null,
    hasRemote: false,
    inProgress: null
  } as unknown as GitRepositoryState
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function change(relativePath: string): unknown {
  return { relativePath, kind: 'modified', originalPath: null, directory: false }
}

function gateOf(overrides: Partial<ReadToolsDependencies> = {}): ReadToolsGate {
  return createReadToolsGate({
    readPolicy: () => Object.freeze({ permissionMode: mode }),
    recordEvent: (event) => events.push(event),
    resolveTarget: (relativePath) => resolveWorkspaceTarget(root, relativePath, 'read'),
    readBytes: readVerifiedFileBytes,
    readDirectory: readWorkspaceDirectory,
    resolvePinnedTarget: resolvePinnedWorkspaceTarget,
    listPinnedDirectory: listPinnedWorkspaceDirectory,
    confirmPinnedRoot: confirmPinnedWorkspaceRoot,
    searchContents: searchWorkspaceFileContents,
    readWorkspaceName: () => 'workspace',
    readGitRepository: async () => git,
    ...overrides
  })
}

describe('file_read', () => {
  it('普通のファイルを、Boundary の対象付きの workspace-file として返す', async () => {
    const outcome = await gateOf().readFile('src/app.ts')

    expect(outcome).toMatchObject({
      ok: true,
      workspacePath: 'src/app.ts',
      item: {
        kind: 'workspace-file',
        text: 'export const value = 1\n// TODO: fix',
        label: 'src/app.ts'
      },
      excerpt: { startLine: 1, endLine: 2, totalLines: 2 },
      truncated: false
    })
    // 許可した読み取りは Audit に残さない。
    expect(events).toEqual([])
  })

  it('中身の Secret は伏せてから返し、External Send Gate もそのまま通る', async () => {
    const outcome = await gateOf().readFile('src/config.ts')

    if (!outcome.ok) {
      throw new Error(`expected ok, got ${outcome.reason}`)
    }

    expect(outcome.item.text).not.toContain(TOKEN)
    expect(outcome.item.text).toContain(SECRET_MASK)
    expect(outcome.excerpt.secretMasked).toBe(true)

    const decision = decideExternalSend(
      { permissionMode: 'ask' },
      { providerId: 'fn-scripted-dev', items: [outcome.item] }
    )

    expect(decision.decision).toBe('allow')
  })

  it('範囲の途中に鍵の本体があっても伏せる', async () => {
    const outcome = await gateOf().readFile('src/key.ts', { startLine: 3, endLine: 3 })

    if (!outcome.ok) {
      throw new Error(`expected ok, got ${outcome.reason}`)
    }

    expect(outcome.item.text).toBe(SECRET_MASK)
  })

  it('Secret ファイル・Secret の置き場所は deny（Audit に残す）', async () => {
    for (const path of ['.env', '.ssh/config']) {
      expect(await gateOf().readFile(path)).toEqual({ ok: false, reason: 'secret-file' })
    }

    expect(events.map((event) => [event.type, event.reason, event.subject])).toEqual([
      ['file-read.denied', 'secret-file', 'file_read'],
      ['file-read.denied', 'secret-file', 'file_read']
    ])
    expect(JSON.stringify(events)).not.toContain('A1b2C3d4E5f6G7h8')
  })

  it('Workspace の外・絶対パスは deny', async () => {
    expect((await gateOf().readFile('../outside.txt')).ok).toBe(false)
    expect((await gateOf().readFile(join(base, 'outside.txt'))).ok).toBe(false)
  })

  it.skipIf(isWindows)('外を指す symlink は deny', async () => {
    await symlink(join(base, 'outside.txt'), join(root, 'src', 'link.txt'))

    expect(await gateOf().readFile('src/link.txt')).toEqual({
      ok: false,
      reason: 'outside-workspace'
    })
  })

  it('binary・フォルダ・無いファイルは deny', async () => {
    expect(await gateOf().readFile('binary.bin')).toEqual({
      ok: false,
      reason: 'unsupported-content'
    })
    expect(await gateOf().readFile('src')).toEqual({ ok: false, reason: 'not-a-file' })
    expect(await gateOf().readFile('missing.ts')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('範囲を省けば先頭から上限まで。上限を超えた範囲は切って truncated', async () => {
    const whole = await gateOf().readFile('long.txt')

    expect(whole).toMatchObject({
      ok: true,
      excerpt: { startLine: 1, endLine: READ_TOOL_MAX_LINES, totalLines: 1000 },
      truncated: true
    })

    const tail = await gateOf().readFile('long.txt', { startLine: 990 })

    expect(tail).toMatchObject({
      ok: true,
      excerpt: { startLine: 990, endLine: 1000 },
      truncated: false
    })
  })

  it('範囲として読めない値は deny', async () => {
    for (const range of ['1-10', { startLine: 0 }, { startLine: 5, endLine: 2 }]) {
      expect(await gateOf().readFile('src/app.ts', range)).toEqual({
        ok: false,
        reason: 'invalid-request'
      })
    }
  })

  it('Read の Permission でも読める（Permission は副作用のある操作だけに効く）', async () => {
    mode = 'read'

    expect((await gateOf().readFile('src/app.ts')).ok).toBe(true)
  })

  it('例外は deny（読んだものを返さない）', async () => {
    const outcome = await gateOf({
      readBytes: () => {
        throw new Error('disk exploded')
      }
    }).readFile('src/app.ts')

    expect(outcome).toEqual({ ok: false, reason: 'gate-failed' })
  })
})

describe('workspace_list', () => {
  it('root を1階層だけ並べ、Secret ファイル・置き場所には印を付ける', async () => {
    const outcome = await gateOf().listDirectory('')

    if (!outcome.ok) {
      throw new Error(`expected ok, got ${outcome.reason}`)
    }

    const byName = new Map(outcome.entries.map((entry) => [entry.name, entry]))

    expect(byName.get('src')).toMatchObject({ type: 'directory', secret: false })
    expect(byName.get('.env')).toMatchObject({ type: 'file', secret: true })
    expect(byName.get('.ssh')).toMatchObject({ type: 'directory', secret: true })
    expect(byName.has('app.ts')).toBe(false)
  })

  it('Secret の置き場所の中は一覧も返さない', async () => {
    expect(await gateOf().listDirectory('.ssh')).toEqual({ ok: false, reason: 'secret-file' })
    expect(events.at(-1)).toMatchObject({ type: 'file-read.denied', subject: 'workspace_list' })
  })

  it('ファイル・Workspace の外は deny', async () => {
    expect((await gateOf().listDirectory('src/app.ts')).ok).toBe(false)
    expect((await gateOf().listDirectory('..')).ok).toBe(false)
  })
})

describe('file_search', () => {
  it('Secret ファイル・置き場所は開きもせず、一致した行は伏せて返す', async () => {
    const outcome = await gateOf().search('TODO')

    if (!outcome.ok) {
      throw new Error(`expected ok, got ${outcome.reason}`)
    }

    const paths = outcome.matches.map((match) => match.relativePath)

    expect(paths).toContain('src/app.ts')
    expect(paths).toContain('src/config.ts')
    expect(paths).not.toContain('.env')
    expect(paths).not.toContain('.ssh/config')
    expect(JSON.stringify(outcome)).not.toContain('A1b2C3d4E5f6G7h8')
  })

  it('鍵の本体の行は、1行だけ見ても伏せる', async () => {
    const outcome = await gateOf().search('MIIEowIBAAKCAQEA')

    if (!outcome.ok) {
      throw new Error(`expected ok, got ${outcome.reason}`)
    }

    expect(outcome.matches).toHaveLength(1)
    expect(outcome.matches[0].preview).toBe(SECRET_MASK)
  })

  it('Secret の値そのもので探しても、値はプレビューに出ない', async () => {
    const outcome = await gateOf().search(TOKEN)

    if (!outcome.ok) {
      throw new Error(`expected ok, got ${outcome.reason}`)
    }

    expect(JSON.stringify(outcome.matches)).not.toContain(TOKEN)
  })

  it('検索語として読めない値は deny', async () => {
    for (const query of ['', '   ', 42, 'a'.repeat(201), null]) {
      expect(await gateOf().search(query)).toEqual({ ok: false, reason: 'invalid-request' })
    }
  })

  it('Secret ファイル・置き場所は、確かめ直し・open のどちらにも渡らない', async () => {
    const touched: string[] = []
    const outcome = await gateOf({
      resolvePinnedTarget: (pinned, relativePath, kind) => {
        touched.push(relativePath)
        return resolvePinnedWorkspaceTarget(pinned, relativePath, kind)
      },
      readBytes: (target) => {
        touched.push(target.canonicalRelativePath)
        return readVerifiedFileBytes(target)
      }
    }).search('TODO')

    expect(outcome).toMatchObject({ ok: true, unverifiedExcludedCount: 0 })
    expect(touched).toContain('src/app.ts')
    expect(touched.filter((path) => path === '.env' || path.startsWith('.ssh'))).toEqual([])
  })
})

/**
 * file_search の TOCTOU（Security Core v1 の STEP9.1）。
 *
 * STEP9 の file_search は、readdir で「リンクでない」と見た後に**パスで**読んでいたため、
 * その間に途中のフォルダ・root を外へのリンクへ差し替えると外の中身が preview に載った
 * （STEP9.1 の調査で、Windows のジャンクションで実際に再現した case1 / case2）。
 *
 * 差し替えは Gate の依存（listPinnedDirectory / readBytes）を包んで、**決まった瞬間に**
 * 起こす（時間に頼る stress test にはしない）。確かめるのは、外の文字列が preview にも
 * Agent の Context にも現れないこと。
 *
 * フォルダのリンクは Windows ではジャンクション（権限なしで作れる）、それ以外では symlink。
 */
describe('file_search の TOCTOU（STEP9.1）', () => {
  const MARKER = 'OUTSIDE-WORKSPACE-MARKER'
  let outsideDirectory: string

  beforeEach(async () => {
    outsideDirectory = join(base, 'outside-dir')

    await mkdir(outsideDirectory)
    await writeFile(join(outsideDirectory, 'z.txt'), `NEEDLE ${MARKER} z\n`)
    await writeFile(join(outsideDirectory, 'a.txt'), `NEEDLE ${MARKER} a\n`)
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'sub', 'z.txt'), 'NEEDLE inside z\n')
    await writeFile(join(root, 'a.txt'), 'NEEDLE inside a\n')
  })

  /** フォルダのリンク（Windows はジャンクション）。 */
  async function linkDirectory(target: string, path: string): Promise<void> {
    await symlink(target, path, isWindows ? 'junction' : 'dir')
  }

  /** ファイルの symlink。作れない環境（開発者モードでない Windows）では false。 */
  async function tryLinkFile(target: string, path: string): Promise<boolean> {
    try {
      await symlink(target, path, 'file')
      return true
    } catch {
      return false
    }
  }

  /** Workspace の中のフォルダを、外のフォルダへのリンクに差し替える。 */
  async function swapToOutside(relativePath: string): Promise<void> {
    await rename(join(root, relativePath), join(base, `moved-${relativePath}`))
    await linkDirectory(outsideDirectory, join(root, relativePath))
  }

  /** Agent の Context へ入る形（agentTools.ts が Context Manager へ渡すもの）。 */
  async function contextOf(gate: ReadToolsGate, query: string): Promise<string> {
    const result = await runAgentTool({ search: gate.search } as unknown as AgentToolbox, {
      type: 'file_search',
      query
    })

    return JSON.stringify(result.context)
  }

  function previewsOf(outcome: Awaited<ReturnType<ReadToolsGate['search']>>): string {
    return outcome.ok ? outcome.matches.map((match) => match.preview).join('\n') : ''
  }

  it('差し替えが無ければ、中の一致を返し、外したものは 0 件', async () => {
    const outcome = await gateOf().search('NEEDLE')

    expect(outcome).toMatchObject({ ok: true, unverifiedExcludedCount: 0 })
    expect(outcome.ok && outcome.matches.map((match) => match.relativePath)).toEqual([
      'a.txt',
      'sub/z.txt'
    ])
    expect(await contextOf(gateOf(), 'NEEDLE')).not.toContain('could not be verified')
  })

  it('Workspace の中を指すリンクの先は検索しない（重複して読まない）', async () => {
    await linkDirectory(join(root, 'sub'), join(root, 'sub-link'))
    // ファイルの symlink は、作れない環境では作らずに確かめる（Windows の既定）。
    await tryLinkFile(join(root, 'a.txt'), join(root, 'a-link.txt'))

    const outcome = await gateOf().search('NEEDLE')
    const paths = outcome.ok ? outcome.matches.map((match) => match.relativePath) : []

    expect(paths).toEqual(['a.txt', 'sub/z.txt'])
    expect(paths.some((path) => path.startsWith('sub-link'))).toBe(false)
    expect(paths.includes('a-link.txt')).toBe(false)
    // 走査の前からあるリンクは readdir の判定で入らないので、数にも入らない。
    expect(outcome).toMatchObject({ ok: true, unverifiedExcludedCount: 0 })
  })

  it('Workspace の外を指すリンク（フォルダ・ファイル）の中身は出ない', async () => {
    await linkDirectory(outsideDirectory, join(root, 'ext'))
    await tryLinkFile(join(outsideDirectory, 'z.txt'), join(root, 'ext.txt'))

    const outcome = await gateOf().search('NEEDLE')

    expect(outcome.ok).toBe(true)
    expect(JSON.stringify(outcome)).not.toContain(MARKER)
    expect(await contextOf(gateOf(), 'NEEDLE')).not.toContain(MARKER)
  })

  it('並べた後に消えたファイルは、読まずにとばして数える（検索全体は止めない）', async () => {
    const outcome = await gateOf({
      resolvePinnedTarget: async (pinned, relativePath, kind) => {
        if (relativePath === 'sub/z.txt') {
          await rm(join(root, 'sub', 'z.txt'))
        }

        return resolvePinnedWorkspaceTarget(pinned, relativePath, kind)
      }
    }).search('NEEDLE')

    expect(outcome).toMatchObject({ ok: true, unverifiedExcludedCount: 1 })
    expect(outcome.ok && outcome.matches.map((match) => match.relativePath)).toEqual(['a.txt'])
  })

  it('case1: dirent の判定の後で途中のフォルダを外へのリンクに差し替えても、外は読まない', async () => {
    let swapped = false
    const gate = gateOf({
      listPinnedDirectory: async (pinned, relativePath) => {
        const listed = await listPinnedWorkspaceDirectory(pinned, relativePath)

        // root を並べ終えた（sub はフォルダでリンクではない、と見た）直後に差し替える。
        if (relativePath === '' && !swapped) {
          swapped = true
          await swapToOutside('sub')
        }

        return listed
      }
    })
    const outcome = await gate.search('NEEDLE')

    expect(swapped).toBe(true)
    expect(outcome).toMatchObject({ ok: true, unverifiedExcludedCount: 1 })
    expect(outcome.ok && outcome.matches.map((match) => match.relativePath)).toEqual(['a.txt'])
    expect(JSON.stringify(outcome)).not.toContain(MARKER)
    expect(previewsOf(outcome)).not.toContain(MARKER)

    swapped = false
    expect(await contextOf(gate, 'NEEDLE')).not.toContain(MARKER)
  })

  it('case2: 検索中に Workspace root 自体を差し替えたら、結果を捨てて全体を deny', async () => {
    let swapped = false
    const gate = gateOf({
      listPinnedDirectory: async (pinned, relativePath) => {
        const listed = await listPinnedWorkspaceDirectory(pinned, relativePath)

        if (relativePath === '' && !swapped) {
          swapped = true
          await rename(root, join(base, 'workspace-moved'))
          await linkDirectory(outsideDirectory, root)
        }

        return listed
      }
    })
    const outcome = await gate.search('NEEDLE')

    expect(swapped).toBe(true)
    expect(outcome).toEqual({ ok: false, reason: 'target-changed' })
    expect(events.at(-1)).toMatchObject({
      type: 'file-read.denied',
      subject: 'file_search',
      reason: 'target-changed'
    })
    expect(JSON.stringify(events)).not.toContain(MARKER)
  })

  it('case2: 差し替えた root の下では Agent の Context にも外の文字列が出ない', async () => {
    let swapped = false
    const gate = gateOf({
      listPinnedDirectory: async (pinned, relativePath) => {
        const listed = await listPinnedWorkspaceDirectory(pinned, relativePath)

        if (relativePath === '' && !swapped) {
          swapped = true
          await rename(root, join(base, 'workspace-moved'))
          await linkDirectory(outsideDirectory, root)
        }

        return listed
      }
    })
    const context = await contextOf(gate, 'NEEDLE')

    expect(swapped).toBe(true)
    expect(context).not.toContain(MARKER)
    expect(context).toContain('target-changed')
  })

  it('resolve と open の間で差し替えても、開いたハンドルの確認で落ち、中身は読まない', async () => {
    const results: string[] = []
    const gate = gateOf({
      readBytes: async (target) => {
        if (target.canonicalRelativePath === 'sub/z.txt') {
          // Boundary が sub/z.txt を中の実体として確かめた後・開く前に差し替える。
          await swapToOutside('sub')
        }

        const read = await readVerifiedFileBytes(target)

        results.push(read.ok ? 'ok' : read.denial)
        return read
      }
    })
    const outcome = await gate.search('NEEDLE')

    expect(results).toContain('handle-unconfirmed')
    expect(outcome).toMatchObject({ ok: true, unverifiedExcludedCount: 1 })
    expect(JSON.stringify(outcome)).not.toContain(MARKER)
  })

  it('確かめ直しで例外が出ても、その位置は読まない', async () => {
    const outcome = await gateOf({
      resolvePinnedTarget: (pinned, relativePath, kind) => {
        if (relativePath === 'sub/z.txt') {
          throw new Error('disk exploded')
        }

        return resolvePinnedWorkspaceTarget(pinned, relativePath, kind)
      }
    }).search('NEEDLE')

    expect(outcome).toMatchObject({ ok: true, unverifiedExcludedCount: 1 })
    expect(outcome.ok && outcome.matches.map((match) => match.relativePath)).toEqual(['a.txt'])
  })

  it('root を確かめられなければ、検索全体を deny', async () => {
    expect(await gateOf({ confirmPinnedRoot: async () => false }).search('NEEDLE')).toEqual({
      ok: false,
      reason: 'target-changed'
    })
  })

  it('外したものがあれば、Agent へは位置も理由も含まない短い note だけ', async () => {
    const context = await contextOf(
      gateOf({
        resolvePinnedTarget: async (pinned, relativePath, kind) =>
          relativePath === 'sub/z.txt'
            ? { ok: false, rootChanged: false }
            : resolvePinnedWorkspaceTarget(pinned, relativePath, kind)
      }),
      'NEEDLE'
    )

    expect(context).toContain('could not be verified as safe')
    expect(context).not.toContain('sub/z.txt')
    expect(context).not.toContain(base)
  })
})

describe('workspace_status', () => {
  it('名前・Permission・ブランチ・変更ファイルの相対パスだけを返す', async () => {
    const outcome = await gateOf().describeStatus()

    expect(outcome).toEqual({
      ok: true,
      workspaceName: 'workspace',
      permissionMode: 'ask',
      git: {
        repository: 'ready',
        branch: 'feature/x',
        detached: false,
        changedPaths: ['.env', 'notes.md', 'src/app.ts'],
        changedPathsTruncated: false
      }
    })
    expect(JSON.stringify(outcome)).not.toContain(base)
  })

  it('Git が使えない・リポジトリでない・読めないときも、状態として返す', async () => {
    git = { status: 'not-a-repository' }
    expect(await gateOf().describeStatus()).toMatchObject({
      ok: true,
      git: { repository: 'not-a-repository', branch: null, changedPaths: [] }
    })

    const failing = await gateOf({
      readGitRepository: () => {
        throw new Error('git exploded')
      }
    }).describeStatus()

    expect(failing).toMatchObject({ ok: true, git: { repository: 'failed' } })
  })

  it('Workspace が無ければ deny', async () => {
    expect(await gateOf({ readWorkspaceName: () => null }).describeStatus()).toEqual({
      ok: false,
      reason: 'no-workspace'
    })
  })
})
