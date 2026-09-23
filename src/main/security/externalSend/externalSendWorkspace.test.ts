import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolveWorkspaceTarget,
  type VerifiedWorkspaceTarget,
  type WorkspaceBoundaryResult
} from '../boundary/workspaceBoundary'
import type { SecurityPolicy } from '../policy/securityPolicy'
import { SECRET_MASK } from '../secret/secretMasking'
import { decideExternalSend, type ExternalSendDecision } from './externalSendDecision'
import { workspaceFileContext } from './workspaceFileContext'

/**
 * Workspace のファイルを External Context に載せる経路（Security Core v1 の STEP5）。
 *
 * Boundary（STEP2）→ Secret ファイルの判定（STEP3）→ Security Decision（STEP1）を
 * 通ったものだけが載ること。**申告では突破できない**こと。
 */

const ASK: SecurityPolicy = Object.freeze({ permissionMode: 'ask' })

let base: string
let root: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-external-send-')))
  root = join(base, 'workspace')

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(base, 'outside.txt'), 'outside')
  await writeFile(join(root, 'src', 'index.ts'), 'export const value = 1\n')
  await writeFile(join(root, '.env'), 'API_KEY=A1b2C3d4E5f6G7h8\n')
  await writeFile(join(root, '.env.local'), 'API_KEY=Z9y8X7w6V5u4T3s2\n')
  await writeFile(join(root, 'server.pem'), '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n')
  await writeFile(join(root, '.env.example'), 'API_KEY=your-api-key-here\n')
  await writeFile(join(root, 'binary.bin'), Buffer.from([0x50, 0x00, 0x4b, 0x00]))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function expectTarget(result: WorkspaceBoundaryResult): VerifiedWorkspaceTarget {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.denial}`)
  }

  return result.target
}

async function readTarget(relativePath: string): Promise<VerifiedWorkspaceTarget> {
  return expectTarget(await resolveWorkspaceTarget(root, relativePath, 'read'))
}

async function bytesOf(relativePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(root, relativePath)))
}

/** File Read Gate（後の STEP）が渡す形。ここから Context を作って Gate へ通す。 */
async function sendFile(relativePath: string): Promise<ExternalSendDecision | string> {
  const context = workspaceFileContext(await readTarget(relativePath), await bytesOf(relativePath))

  if (!context.ok) {
    return context.reason
  }

  return decideExternalSend(ASK, { providerId: 'anthropic', items: [context.item] })
}

function denialOf(decision: ExternalSendDecision | string): string {
  if (typeof decision === 'string') {
    return decision
  }

  return decision.decision === 'deny' ? decision.reason : 'allow'
}

/** フォルダのリンク。Windows ではジャンクション（権限なしで作れる）を使う。 */
async function linkDirectory(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('Workspace の中の普通のファイル', () => {
  it('Boundary を通った Context は allow で、実体の綴りが label になる', async () => {
    const decision = await sendFile('src/index.ts')

    expect(typeof decision).not.toBe('string')

    if (typeof decision === 'string' || decision.decision !== 'allow') {
      throw new Error(`expected allow, got ${denialOf(decision)}`)
    }

    expect(decision.payload.parts).toEqual([
      { kind: 'workspace-file', label: 'src/index.ts', text: 'export const value = 1\n' }
    ])
    expect(decision.payload.notice.userNoticeRequired).toBe(false)
  })

  it('label に絶対パスは入らない', async () => {
    const decision = await sendFile('src/index.ts')

    expect(JSON.stringify(decision)).not.toContain(root.replace(/\\/g, '\\\\'))
  })
})

describe('Secret ファイルは Context へ入れない（Mask して送るのではなく deny）', () => {
  it.each(['.env', '.env.local', 'server.pem'])('%s は deny', async (relativePath) => {
    expect(denialOf(await sendFile(relativePath))).toBe('secret-file')
  })

  it('中身は1文字も外へ出ない', async () => {
    const context = workspaceFileContext(await readTarget('.env'), await bytesOf('.env'))

    expect(context).toEqual({ ok: false, reason: 'secret-file' })
    expect(JSON.stringify(context)).not.toContain('A1b2C3d4E5f6G7h8')
  })

  it('Secret ファイルの中身を、別の種類の Context として持ち込んでも source は付けられない', async () => {
    const decision = decideExternalSend(ASK, {
      providerId: 'anthropic',
      items: [
        { kind: 'tool-result', text: 'API_KEY=A1b2C3d4E5f6G7h8', source: await readTarget('.env') }
      ]
    })

    expect(denialOf(decision)).toBe('invalid-payload')
  })

  it('Secret ファイルの中身を種類だけ変えて渡しても、値は伏せられる', async () => {
    const decision = decideExternalSend(ASK, {
      providerId: 'anthropic',
      items: [{ kind: 'tool-result', text: 'API_KEY=A1b2C3d4E5f6G7h8' }]
    })

    if (decision.decision !== 'allow') {
      throw new Error(`expected allow, got ${decision.reason}`)
    }

    expect(decision.payload.parts[0].text).toBe(`API_KEY=${SECRET_MASK}`)
    expect(JSON.stringify(decision.payload)).not.toContain('A1b2C3d4E5f6G7h8')
  })
})

describe('雛形は読めるが、中身は必ず検査する', () => {
  it('.env.example は allow（雛形の値は伏せない）', async () => {
    const decision = await sendFile('.env.example')

    if (typeof decision === 'string' || decision.decision !== 'allow') {
      throw new Error(`expected allow, got ${denialOf(decision)}`)
    }

    expect(decision.payload.parts[0].text).toBe('API_KEY=your-api-key-here\n')
    expect(decision.payload.notice.secretsMasked).toBe(false)
  })

  it('.env.example に本物の値が書かれていれば、伏せて送る', async () => {
    await writeFile(
      join(root, '.env.example'),
      'API_KEY=sk-ant-api03-Abcdefghijklmnopqrstuvwxyz0123\n'
    )

    const decision = await sendFile('.env.example')

    if (typeof decision === 'string' || decision.decision !== 'allow') {
      throw new Error(`expected allow, got ${denialOf(decision)}`)
    }

    expect(decision.payload.parts[0].text).toBe(`API_KEY=${SECRET_MASK}\n`)
    expect(decision.payload.notice.userNoticeRequired).toBe(true)
    expect(decision.payload.notice.categories).toContain('provider-api-key')
    expect(JSON.stringify(decision.payload)).not.toContain('sk-ant-api03')
  })
})

describe('Workspace の外', () => {
  it('Boundary が対象を発行しない（外のファイル）', async () => {
    const result = await resolveWorkspaceTarget(root, '../outside.txt', 'read')

    expect(result).toEqual({ ok: false, denial: 'invalid-path' })
  })

  it('外を指すリンクを通した Context も、対象が作れないので載せられない', async () => {
    await linkDirectory(base, join(root, 'escape'))

    const result = await resolveWorkspaceTarget(root, 'escape/outside.txt', 'read')

    expect(result).toEqual({ ok: false, denial: 'outside-workspace' })
  })

  it('中を指すリンクは解決され、実体の綴りで載る', async () => {
    await linkDirectory(join(root, 'src'), join(root, 'alias'))

    const target = await readTarget('alias/index.ts')
    const context = workspaceFileContext(target, await bytesOf('src/index.ts'))

    expect(context.ok).toBe(true)

    if (context.ok) {
      expect(context.item.label).toBe('src/index.ts')
    }
  })
})

describe('申告では突破できない', () => {
  it('偽の insideWorkspace: true', () => {
    const decision = decideExternalSend(ASK, {
      providerId: 'anthropic',
      items: [
        {
          kind: 'workspace-file',
          text: 'secret',
          source: { insideWorkspace: true, secretFile: false, access: 'read' }
        }
      ]
    })

    expect(denialOf(decision)).toBe('outside-workspace')
  })

  it('偽の secretFile: false（Boundary の対象を写したもの）', async () => {
    const target = await readTarget('.env')
    const copy = { ...target, secretFile: false, insideWorkspace: true }

    const decision = decideExternalSend(ASK, {
      providerId: 'anthropic',
      items: [{ kind: 'workspace-file', text: 'API_KEY=…', source: copy }]
    })

    expect(denialOf(decision)).toBe('outside-workspace')
  })

  it('source が無い workspace-file', () => {
    const decision = decideExternalSend(ASK, {
      providerId: 'anthropic',
      items: [{ kind: 'workspace-file', text: 'export const value = 1' }]
    })

    expect(denialOf(decision)).toBe('outside-workspace')
  })

  it('書き込みとして確かめた対象は、読み取りの Context には使えない', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/index.ts', 'write'))

    expect(workspaceFileContext(target, await bytesOf('src/index.ts'))).toEqual({
      ok: false,
      reason: 'outside-workspace'
    })
  })
})

describe('中身の形で載せられないもの', () => {
  it('binary は文字列にせずに deny', async () => {
    expect(denialOf(await sendFile('binary.bin'))).toBe('unsupported-context')
  })

  it('バイト列として読めないものは deny', async () => {
    const target = await readTarget('src/index.ts')

    for (const bytes of [undefined, null, 'text', Buffer.from('x').toString()]) {
      expect(workspaceFileContext(target, bytes)).toEqual({ ok: false, reason: 'unverifiable' })
    }
  })

  it('上限を超えたファイルは deny', async () => {
    const target = await readTarget('src/index.ts')
    const bytes = new Uint8Array(3 * 1024 * 1024)

    bytes.fill(0x61)

    expect(workspaceFileContext(target, bytes)).toEqual({
      ok: false,
      reason: 'context-too-large'
    })
  })
})
