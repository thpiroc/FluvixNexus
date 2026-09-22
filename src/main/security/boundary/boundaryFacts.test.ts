import { link, mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decideSecurityAction } from '../policy/securityDecision'
import type { SecurityPolicy } from '../policy/securityPolicy'
import { fileReadTargetFacts, fileWriteTargetFacts } from './boundaryFacts'
import {
  resolveWorkspaceTarget,
  type VerifiedWorkspaceTarget,
  type WorkspaceBoundaryResult
} from './workspaceBoundary'

/**
 * Boundary の結果 → Security Decision（STEP1）への接続（Security Core v1 の STEP2）。
 *
 * 事実は Boundary が作った対象からだけ生まれ、同じ形のオブジェクトや自己申告からは
 * 生まれないこと。Secret の判定（STEP3）が無い間は、`false` が渡されない限り
 * Secret と読んで拒否になること。
 */

const ASK: SecurityPolicy = Object.freeze({ permissionMode: 'ask' })
const READ: SecurityPolicy = Object.freeze({ permissionMode: 'read' })

let base: string
let root: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-boundary-facts-')))
  root = join(base, 'workspace')

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'a.txt'), 'inside')
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

describe('fileReadTargetFacts', () => {
  it('Boundary が読み取りとして確かめた対象は Workspace の中', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))

    expect(fileReadTargetFacts(target, false)).toEqual({
      insideWorkspace: true,
      secretFile: false
    })
    expect(
      decideSecurityAction(READ, { kind: 'file.read', target: fileReadTargetFacts(target, false) })
    ).toEqual({
      verdict: 'allow',
      reason: 'read-allowed'
    })
  })

  it('hard link でも、読み取りはそれだけでは拒否しない', async () => {
    await link(join(root, 'a.txt'), join(root, 'twin.txt'))

    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))

    expect(
      decideSecurityAction(ASK, { kind: 'file.read', target: fileReadTargetFacts(target, false) })
        .verdict
    ).toBe('allow')
  })

  it('Secret の判定が渡されなければ（STEP3 以前）Secret と読んで拒否する', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))

    for (const secretFile of [undefined, null, 'false', 0, true]) {
      expect(fileReadTargetFacts(target, secretFile).secretFile).toBe(true)
      expect(
        decideSecurityAction(ASK, {
          kind: 'file.read',
          target: fileReadTargetFacts(target, secretFile)
        })
      ).toEqual({ verdict: 'deny', reason: 'secret-file' })
    }
  })

  it('書き込みとして確かめた対象からは作らない', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    expect(fileReadTargetFacts(target, false).insideWorkspace).toBe(false)
  })
})

describe('fileWriteTargetFacts', () => {
  it('リンク数 1 の既存のファイル → Ask なら承認待ち・Read なら拒否', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))
    const facts = fileWriteTargetFacts(target, false)

    expect(facts).toEqual({ insideWorkspace: true, secretFile: false, hardLink: false })
    expect(decideSecurityAction(ASK, { kind: 'file.write', target: facts })).toEqual({
      verdict: 'ask',
      reason: 'approval-required'
    })
    expect(decideSecurityAction(READ, { kind: 'file.write', target: facts })).toEqual({
      verdict: 'deny',
      reason: 'read-only-mode'
    })
  })

  it('リンク数 2 以上のファイル → hard link として拒否', async () => {
    await link(join(root, 'a.txt'), join(root, 'twin.txt'))

    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))
    const facts = fileWriteTargetFacts(target, false)

    expect(facts.hardLink).toBe(true)
    expect(decideSecurityAction(ASK, { kind: 'file.write', target: facts })).toEqual({
      verdict: 'deny',
      reason: 'hard-link-write'
    })
  })

  it('まだ無いファイルは hard link ではない', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/new.ts', 'write'))

    expect(fileWriteTargetFacts(target, false)).toEqual({
      insideWorkspace: true,
      secretFile: false,
      hardLink: false
    })
  })

  it('Secret の判定が渡されなければ拒否する', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    expect(
      decideSecurityAction(ASK, {
        kind: 'file.write',
        target: fileWriteTargetFacts(target, undefined)
      })
    ).toEqual({
      verdict: 'deny',
      reason: 'secret-file'
    })
  })

  it('読み取りとして確かめた対象からは作らない', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))

    expect(fileWriteTargetFacts(target, false)).toEqual({
      insideWorkspace: false,
      secretFile: true,
      hardLink: true
    })
  })
})

describe('Boundary が作っていないものからは、拒否になる事実しか生まれない', () => {
  it('同じ形に写したオブジェクト', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))
    const copy = { ...target }

    expect(fileWriteTargetFacts(copy, false)).toEqual({
      insideWorkspace: false,
      secretFile: true,
      hardLink: true
    })
    expect(fileReadTargetFacts({ ...target, access: 'read' }, false).insideWorkspace).toBe(false)
  })

  it('自己申告（検証済みを名乗る真偽値）', () => {
    const claims = [
      { insideWorkspace: true, hardLink: false, secretFile: false },
      { verified: true },
      { ok: true, target: { access: 'write' } },
      null,
      undefined,
      'a.txt',
      true
    ]

    for (const claim of claims) {
      expect(
        decideSecurityAction(ASK, {
          kind: 'file.write',
          target: fileWriteTargetFacts(claim, false)
        })
      ).toEqual({
        verdict: 'deny',
        reason: 'outside-workspace'
      })
      expect(
        decideSecurityAction(ASK, { kind: 'file.read', target: fileReadTargetFacts(claim, false) })
      ).toEqual({
        verdict: 'deny',
        reason: 'outside-workspace'
      })
    }
  })

  it('Boundary の拒否結果そのもの', async () => {
    const denied = await resolveWorkspaceTarget(root, '../outside.txt', 'write')

    expect(denied.ok).toBe(false)
    expect(fileWriteTargetFacts(denied, false).insideWorkspace).toBe(false)
  })

  it('返す事実は凍結されている', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    expect(Object.isFrozen(fileWriteTargetFacts(target, false))).toBe(true)
    expect(Object.isFrozen(fileReadTargetFacts(null, false))).toBe(true)
  })
})
