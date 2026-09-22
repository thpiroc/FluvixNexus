import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decideSecurityAction } from '../policy/securityDecision'
import type { SecurityPolicy } from '../policy/securityPolicy'
import {
  resolveWorkspaceTarget,
  type VerifiedWorkspaceTarget,
  type WorkspaceBoundaryResult
} from '../boundary/workspaceBoundary'
import { maskSecretText, SECRET_MASK } from './secretMasking'
import { scanTargetFromBytes } from './secretScan'
import { agentFileReadFacts, agentFileWriteFacts, isSecretWorkspaceTarget } from './secretFileFacts'

/**
 * Boundary（STEP2）→ Secret ファイルの判定（STEP3）→ Security Decision（STEP1）の接続。
 *
 * 事実は Boundary が発行した対象からだけ生まれ、`{ secretFile: false }` のような
 * 申告では突破できないこと。
 */

const ASK: SecurityPolicy = Object.freeze({ permissionMode: 'ask' })

let base: string
let root: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-secret-facts-')))
  root = join(base, 'workspace')

  await mkdir(join(root, 'config'), { recursive: true })
  await writeFile(join(root, 'notes.txt'), 'ordinary')
  await writeFile(join(root, '.env'), 'API_KEY=A1b2C3d4E5f6G7h8')
  await writeFile(join(root, '.env.example'), 'API_KEY=your-api-key-here')
  await writeFile(join(root, 'config', 'credentials.json'), '{}')
  await writeFile(join(root, 'server.pem'), 'key')
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

/**
 * フォルダのリンク。Windows ではジャンクション（権限なしで作れる）を使う
 * ── ファイルの symlink は開発者モードか管理者権限が要るため、綴りの食い違いは
 * フォルダのリンクで作る（workspaceBoundary.test.ts と同じ手）。
 */
async function linkDirectory(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('Secret ファイルの読み取りは拒否になる', () => {
  it('.env / 資格情報 / 鍵', async () => {
    for (const relativePath of ['.env', 'config/credentials.json', 'server.pem']) {
      const target = expectTarget(await resolveWorkspaceTarget(root, relativePath, 'read'))

      expect(isSecretWorkspaceTarget(target)).toBe(true)
      expect(agentFileReadFacts(target)).toEqual({ insideWorkspace: true, secretFile: true })
      expect(
        decideSecurityAction(ASK, { kind: 'file.read', target: agentFileReadFacts(target) })
      ).toEqual({ verdict: 'deny', reason: 'secret-file' })
    }
  })

  it('書き込みも拒否になる', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, '.env', 'write'))

    expect(agentFileWriteFacts(target)).toEqual({
      insideWorkspace: true,
      secretFile: true,
      hardLink: false
    })
    expect(
      decideSecurityAction(ASK, { kind: 'file.write', target: agentFileWriteFacts(target) })
    ).toEqual({ verdict: 'deny', reason: 'secret-file' })
  })
})

describe('Secret ファイルでなければ通る', () => {
  it('普通のファイルは読める', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'notes.txt', 'read'))

    expect(isSecretWorkspaceTarget(target)).toBe(false)
    expect(agentFileReadFacts(target)).toEqual({ insideWorkspace: true, secretFile: false })
    expect(
      decideSecurityAction(ASK, { kind: 'file.read', target: agentFileReadFacts(target) })
    ).toEqual({ verdict: 'allow', reason: 'read-allowed' })
  })

  it('.env.example は読める（中身は Mask を通す）', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, '.env.example', 'read'))

    expect(isSecretWorkspaceTarget(target)).toBe(false)
    expect(
      decideSecurityAction(ASK, { kind: 'file.read', target: agentFileReadFacts(target) }).verdict
    ).toBe('allow')
  })

  it('credential という名前のソースコードも読める（中身は Mask する）', async () => {
    await mkdir(join(root, 'src', 'auth'), { recursive: true })
    await writeFile(
      join(root, 'src', 'auth', 'credentials.ts'),
      "export const apiKey = 'A1b2C3d4E5f6G7h8'\n"
    )

    const target = expectTarget(
      await resolveWorkspaceTarget(root, 'src/auth/credentials.ts', 'read')
    )

    expect(isSecretWorkspaceTarget(target)).toBe(false)
    expect(
      decideSecurityAction(ASK, { kind: 'file.read', target: agentFileReadFacts(target) }).verdict
    ).toBe('allow')

    // 読めるが、中身の本物の値は渡らない。
    const scanned = scanTargetFromBytes(await readFile(target.realPath))

    expect(scanned.kind).toBe('text')

    const masked = maskSecretText(scanned.kind === 'text' ? scanned.text : null)

    expect(masked.text).toBe(`export const apiKey = '${SECRET_MASK}'\n`)
    expect(masked.userNoticeRequired).toBe(true)
  })

  it('普通のファイルへの書き込みは承認を求める段階まで進む', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'notes.txt', 'write'))

    expect(
      decideSecurityAction(ASK, { kind: 'file.write', target: agentFileWriteFacts(target) })
    ).toEqual({ verdict: 'ask', reason: 'approval-required' })
  })
})

describe('指した綴りと実体の綴りの両方を見る', () => {
  it('普通の綴りで指しても、実体が鍵置き場なら Secret', async () => {
    await mkdir(join(root, '.ssh'))
    await writeFile(join(root, '.ssh', 'notes.txt'), 'looks ordinary')
    await linkDirectory(join(root, '.ssh'), join(root, 'docs'))

    const target = expectTarget(await resolveWorkspaceTarget(root, 'docs/notes.txt', 'read'))

    expect(target.requestedRelativePath).toBe('docs/notes.txt')
    expect(target.canonicalRelativePath).toBe('.ssh/notes.txt')
    expect(isSecretWorkspaceTarget(target)).toBe(true)
    expect(
      decideSecurityAction(ASK, { kind: 'file.read', target: agentFileReadFacts(target) })
    ).toEqual({ verdict: 'deny', reason: 'secret-file' })
  })

  it('実体が普通でも、指した綴りが鍵置き場なら Secret', async () => {
    await writeFile(join(root, 'config', 'plain.txt'), 'ordinary')
    await linkDirectory(join(root, 'config'), join(root, '.ssh'))

    const target = expectTarget(await resolveWorkspaceTarget(root, '.ssh/plain.txt', 'read'))

    expect(target.canonicalRelativePath).toBe('config/plain.txt')
    expect(isSecretWorkspaceTarget(target)).toBe(true)
  })
})

describe('申告では突破できない', () => {
  it('同じ形のオブジェクトを渡しても、Secret でないことにはならない', () => {
    const forged = [
      { insideWorkspace: true, secretFile: false },
      { access: 'read', requestedRelativePath: 'notes.txt', canonicalRelativePath: 'notes.txt' },
      { secretFile: false },
      undefined,
      null,
      'notes.txt',
      {}
    ]

    for (const value of forged) {
      expect(isSecretWorkspaceTarget(value)).toBe(true)
      expect(agentFileReadFacts(value)).toEqual({ insideWorkspace: false, secretFile: true })
      expect(
        decideSecurityAction(ASK, { kind: 'file.read', target: agentFileReadFacts(value) })
      ).toEqual({ verdict: 'deny', reason: 'outside-workspace' })
    }
  })

  it('Boundary の対象を写したものも通らない', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'notes.txt', 'read'))
    const copy = { ...target }

    expect(isSecretWorkspaceTarget(target)).toBe(false)
    expect(isSecretWorkspaceTarget(copy)).toBe(true)
    expect(agentFileReadFacts(copy).insideWorkspace).toBe(false)
  })

  it('対象に secretFile を足せない（Boundary の対象は凍結してある）', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, '.env', 'read'))

    expect(Object.isFrozen(target)).toBe(true)
    expect(() => Object.assign(target as object, { secretFile: false })).toThrow()
    expect(isSecretWorkspaceTarget(target)).toBe(true)
    expect(agentFileReadFacts(target).secretFile).toBe(true)
  })

  it('返す事実は凍結してある', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'notes.txt', 'read'))

    expect(Object.isFrozen(agentFileReadFacts(target))).toBe(true)
    expect(Object.isFrozen(agentFileWriteFacts(target))).toBe(true)
  })
})
