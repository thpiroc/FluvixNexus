import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveWorkspaceTarget, type VerifiedWorkspaceTarget } from '../boundary/workspaceBoundary'
import {
  approvalActionKindOf,
  normalizeApprovalRequest,
  APPROVAL_ARG_MAX_LENGTH,
  APPROVAL_COMMAND_LINE_MAX_LENGTH,
  APPROVAL_COMMAND_MAX_LENGTH,
  APPROVAL_CONTENT_MAX_CHARS,
  APPROVAL_MAX_ARGS
} from './approvalAction'

/**
 * 承認を求める操作の形（Security Core v1 の STEP6）。
 *
 * ここを通るまでは何も確かめられていない、という前提を固定する。
 * 書き込み先は **Boundary（STEP2）が実際にディスクを見て発行した対象**だけで、
 * 同じ形に写したものも自己申告も通らないこと。
 */

let root: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-approval-action-')))

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeTarget(relativePath: string): Promise<VerifiedWorkspaceTarget> {
  const result = await resolveWorkspaceTarget(root, relativePath, 'write')

  if (!result.ok) {
    throw new Error(`expected a verified target, got ${result.denial}`)
  }

  return result.target
}

async function readTarget(relativePath: string): Promise<VerifiedWorkspaceTarget> {
  const result = await resolveWorkspaceTarget(root, relativePath, 'read')

  if (!result.ok) {
    throw new Error(`expected a verified target, got ${result.denial}`)
  }

  return result.target
}

describe('File Write', () => {
  it('Boundary が書き込みとして確かめた対象と、本文だけを受け取る', async () => {
    const target = await writeTarget('src/app.ts')
    const result = normalizeApprovalRequest({ kind: 'file.write', target, content: 'hello' })

    expect(result.ok).toBe(true)

    if (result.ok && result.action.kind === 'file.write') {
      expect(result.action.canonicalRelativePath).toBe('src/app.ts')
      expect(result.action.content).toBe('hello')
      expect(result.action.target).toBe(target)
    }
  })

  it('Boundary の対象でなければ拒む（自己申告も、写したものも）', async () => {
    const target = await writeTarget('src/app.ts')

    for (const fake of [
      { insideWorkspace: true, access: 'write', canonicalRelativePath: 'src/app.ts' },
      { ...target },
      JSON.parse(
        JSON.stringify(target, (_key, value: unknown) =>
          typeof value === 'bigint' ? String(value) : value
        )
      ) as unknown,
      'src/app.ts',
      null,
      undefined
    ]) {
      expect(normalizeApprovalRequest({ kind: 'file.write', target: fake, content: 'x' })).toEqual({
        ok: false,
        denial: 'invalid-request'
      })
    }
  })

  it('読み取りとして確かめた対象は流用させない', async () => {
    const target = await readTarget('src/app.ts')

    expect(normalizeApprovalRequest({ kind: 'file.write', target, content: 'x' })).toEqual({
      ok: false,
      denial: 'invalid-request'
    })
  })

  it('まだ無いファイルも書き込みの対象になる', async () => {
    const target = await writeTarget('src/created.ts')
    const result = normalizeApprovalRequest({ kind: 'file.write', target, content: 'x' })

    expect(result.ok).toBe(true)
  })

  it('本文は文字列で、上限を超えたら縮めずに拒む', async () => {
    const target = await writeTarget('src/app.ts')

    expect(
      normalizeApprovalRequest({
        kind: 'file.write',
        target,
        content: 'a'.repeat(APPROVAL_CONTENT_MAX_CHARS)
      }).ok
    ).toBe(true)

    for (const content of [
      'a'.repeat(APPROVAL_CONTENT_MAX_CHARS + 1),
      undefined,
      123,
      Buffer.from('x')
    ]) {
      expect(normalizeApprovalRequest({ kind: 'file.write', target, content }).ok).toBe(false)
    }
  })
})

describe('Terminal', () => {
  it('command / args / cwd を分けたまま受け取る', () => {
    const result = normalizeApprovalRequest({
      kind: 'terminal.run',
      command: 'npm',
      args: ['run', 'test'],
      cwd: 'packages/app'
    })

    expect(result).toEqual({
      ok: true,
      action: { kind: 'terminal.run', command: 'npm', args: ['run', 'test'], cwd: 'packages/app' }
    })
  })

  it('cwd の空文字は Workspace root として受け取る', () => {
    expect(
      normalizeApprovalRequest({ kind: 'terminal.run', command: 'npm', args: [], cwd: '' }).ok
    ).toBe(true)
  })

  it('形の違う command / args / cwd は拒む', () => {
    const base = { kind: 'terminal.run', command: 'npm', args: [] as unknown[], cwd: '' }

    for (const patch of [
      { command: '' },
      { command: ' npm' },
      { command: 'npm\n--force' },
      { command: 'a'.repeat(APPROVAL_COMMAND_MAX_LENGTH + 1) },
      { command: 42 },
      { args: 'run test' },
      { args: [1, 2] },
      { args: ['ok', 'a'.repeat(APPROVAL_ARG_MAX_LENGTH + 1)] },
      { args: ['line\nbreak'] },
      { args: Array.from({ length: APPROVAL_MAX_ARGS + 1 }, () => 'x') },
      { cwd: '../outside' },
      { cwd: '/abs' },
      { cwd: 'C:/abs' },
      { cwd: 'a\\b' },
      { cwd: 5 }
    ]) {
      expect(normalizeApprovalRequest({ ...base, ...patch }).ok).toBe(false)
    }
  })

  it('コマンド全体は 2,000 文字まで（区切りの空白を含めて数え、超えたら縮めずに拒む）', () => {
    // npm（3）＋ 空白と引数（1 + 498）× 3 ＋（1 + 499）＝ 2,000 文字。
    const head = Array.from({ length: 3 }, () => 'a'.repeat(498))
    const base = { kind: 'terminal.run', command: 'npm', cwd: '' }

    expect(APPROVAL_COMMAND_LINE_MAX_LENGTH).toBe(2_000)
    expect(normalizeApprovalRequest({ ...base, args: [...head, 'a'.repeat(499)] }).ok).toBe(true)
    expect(normalizeApprovalRequest({ ...base, args: [...head, 'a'.repeat(500)] })).toEqual({
      ok: false,
      denial: 'invalid-request'
    })
  })

  it('見た目に現れない・見た目を組み替える文字は拒む（STEP8）', () => {
    const base = { kind: 'terminal.run', command: 'npm', args: [] as unknown[], cwd: '' }

    for (const patch of [
      { args: ['safe‮txt.exe'] }, // 右から左への上書き
      { args: ['a​b'] }, // ゼロ幅空白
      { args: ['﻿run'] }, // BOM
      { args: ['a b'] }, // 行の区切り
      { args: ['a\u0085b'] }, // C1 制御文字
      { args: ['a\uD800b'] }, // 対になっていないサロゲート
      { command: 'np‍m' }
    ]) {
      expect(normalizeApprovalRequest({ ...base, ...patch }).ok).toBe(false)
    }

    // 日本語や全角の文字そのものは拒まない。
    expect(normalizeApprovalRequest({ ...base, args: ['-m', '日本語のメッセージ'] }).ok).toBe(true)
  })
})

describe('知らない操作', () => {
  it('承認の対象になるのは file.write / terminal.run だけ', () => {
    for (const kind of [
      'mcp.write',
      'mcp.read',
      'git.commit',
      'git.push',
      'file.read',
      'external-send',
      'toString',
      '',
      42
    ]) {
      expect(normalizeApprovalRequest({ kind })).toEqual({ ok: false, denial: 'unknown-action' })
    }
  })

  it('形そのものが違えば invalid-request', () => {
    for (const raw of [null, undefined, 'file.write', 42, ['file.write']]) {
      expect(normalizeApprovalRequest(raw)).toEqual({ ok: false, denial: 'invalid-request' })
    }
  })

  it('getter が投げても拒否側へ倒れる', () => {
    const raw = {
      get kind(): string {
        throw new Error('boom')
      }
    }

    expect(normalizeApprovalRequest(raw)).toEqual({ ok: false, denial: 'invalid-request' })
    expect(approvalActionKindOf(raw)).toBeNull()
  })

  it('記録のために種類だけを読める', () => {
    expect(approvalActionKindOf({ kind: 'terminal.run' })).toBe('terminal.run')
    expect(approvalActionKindOf({ kind: 'mcp.write' })).toBeNull()
    expect(approvalActionKindOf(null)).toBeNull()
  })
})
