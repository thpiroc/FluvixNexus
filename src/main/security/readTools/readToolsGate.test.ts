import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GitRepositoryState } from '@shared/git'
import type { AgentPermissionMode } from '@shared/security'
import { readWorkspaceDirectory } from '../../files/readWorkspaceDirectory'
import { searchWorkspaceFileContents } from '../../files/searchWorkspaceFileContents'
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
import { readVerifiedFileBytes } from './readToolsIo'

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
