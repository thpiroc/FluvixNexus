import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentPermissionMode } from '@shared/security'
import { isWindows } from '../../platform'
import type { AuditEvent } from '../audit/auditEvent'
import type { ApprovalConsumeResult, ApprovalOutcome } from '../approval/approvalManager'
import {
  recheckWorkspaceTarget,
  resolveWorkspaceTarget,
  type VerifiedWorkspaceTarget
} from '../boundary/workspaceBoundary'
import {
  createSideEffectLock,
  type SideEffectAcquireResult,
  type SideEffectLock
} from '../sideEffect/sideEffectLock'
import { readCurrentFile, writeConfirmedFile } from './fileWriteIo'
import {
  createFileWriteGate,
  type FileWriteGateDependencies,
  type FileWriteProposalNotice
} from './fileWriteGate'

/**
 * File Write Gate の全体（Security Core v1 の STEP7）。
 *
 * Boundary（STEP2）・Secret（STEP3）・Policy（STEP1）・書き込み（fileWriteIo.ts）は
 * **本物を通す** ── 差し替えるのは承認（STEP6）と Renderer への知らせだけ。
 * 「承認さえ通れば書ける」ではないことを、実際のディスクに対して確かめる。
 *
 * ```
 * base/
 *   workspace/        ← root
 *     a.txt
 *     .env
 *     sub/
 *   outside/
 * ```
 */

let base: string
let root: string
let outside: string

let events: AuditEvent[]
let proposals: FileWriteProposalNotice[]
let settled: string[]
let approvals: { request: unknown; approvalId: string }[]
let consumed: { approvalId: unknown; request: unknown }[]
/** 承認を求めたときに渡された signal（求めた順）。 */
let approvalSignals: (AbortSignal | undefined)[]

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-write-gate-')))
  root = join(base, 'workspace')
  outside = join(base, 'outside')

  await mkdir(join(root, 'sub'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, 'a.txt'), 'one\ntwo\n')
  await writeFile(join(root, '.env'), 'TOKEN=abcdefghijklmnop\n')
  await writeFile(join(outside, 'victim.txt'), 'outside\n')

  events = []
  proposals = []
  settled = []
  approvals = []
  consumed = []
  approvalSignals = []
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

interface GateOptions {
  readonly mode?: AgentPermissionMode
  /** 承認の結末（既定は approved）。 */
  readonly approve?: (request: unknown) => Promise<ApprovalOutcome>
  /** consume の結末（既定は ok）。 */
  readonly consume?: (approvalId: unknown, request: unknown) => ApprovalConsumeResult
  /** 承認を待っている間に起きること（ディスクの変化を差し込む）。 */
  readonly duringApproval?: () => Promise<void>
  /** 副作用の共有ロック（STEP9。既定はこの Gate だけのもの）。 */
  readonly lock?: SideEffectLock
  /** Boundary の解決・確かめ直しの差し替え（その間に起きることを差し込む）。 */
  readonly resolveTarget?: FileWriteGateDependencies['resolveTarget']
  readonly recheckTarget?: FileWriteGateDependencies['recheckTarget']
}

function gateOf(options: GateOptions = {}) {
  const lock = options.lock ?? createSideEffectLock()
  const deps: FileWriteGateDependencies = {
    acquireSideEffect: (kind) => lock.acquire(kind),
    readPolicy: () => ({ permissionMode: options.mode ?? 'ask' }),
    recordEvent: (event) => {
      events.push(event)
    },
    resolveTarget:
      options.resolveTarget ??
      ((relativePath) => resolveWorkspaceTarget(root, relativePath, 'write')),
    recheckTarget:
      options.recheckTarget ??
      ((target: VerifiedWorkspaceTarget) => recheckWorkspaceTarget(target)),
    readCurrent: readCurrentFile,
    writeFile: writeConfirmedFile,
    requestApproval: async (request, signal) => {
      const approvalId = `approval-${approvals.length + 1}`

      approvals.push({ request, approvalId })
      approvalSignals.push(signal)

      await options.duringApproval?.()

      return (
        (await options.approve?.(request)) ??
        Object.freeze({
          decision: 'approved' as const,
          approvalId,
          summary: {
            actionKind: 'file.write' as const,
            subject: 'x',
            workspacePath: 'x',
            commandSummary: null
          }
        })
      )
    },
    consumeApproval: (approvalId, request) => {
      consumed.push({ approvalId, request })

      return options.consume?.(approvalId, request) ?? OK_CONSUME
    },
    notifyProposed: (notice) => {
      proposals.push(notice)
    },
    notifySettled: (proposalId) => {
      settled.push(proposalId)
    },
    createProposalId: () => `proposal-${proposals.length + 1}`
  }

  return createFileWriteGate(deps)
}

const OK_CONSUME: ApprovalConsumeResult = Object.freeze({
  ok: true,
  summary: {
    actionKind: 'file.write' as const,
    subject: 'x',
    workspacePath: 'x',
    commandSummary: null
  }
})

function eventTypes(): readonly string[] {
  return events.map((event) => event.type)
}

describe('Policy（STEP1）', () => {
  it('read の Permission では書かない（承認も求めない）', async () => {
    const outcome = await gateOf({ mode: 'read' }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'read-only-mode' })
    expect(approvals).toEqual([])
    expect(proposals).toEqual([])
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('read では、Diff も Renderer へ送らない', async () => {
    await gateOf({ mode: 'read' }).write('a.txt', 'next\n')

    expect(proposals).toEqual([])
  })

  it('Policy を読めなければ read として扱う', async () => {
    const gate = createFileWriteGate({
      ...baseDeps(),
      readPolicy: () => {
        throw new Error('unreadable')
      }
    })

    expect(await gate.write('a.txt', 'next\n')).toEqual({ ok: false, reason: 'read-only-mode' })
  })

  it('ask では承認へ進む', async () => {
    const outcome = await gateOf().write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: true, workspacePath: 'a.txt' })
    expect(approvals.length).toBe(1)
  })
})

describe('Boundary（STEP2）', () => {
  it('Workspace の外は書かない', async () => {
    const outcome = await gateOf().write('../outside/victim.txt', 'x')

    expect(outcome.ok).toBe(false)
    expect(await readFile(join(outside, 'victim.txt'), 'utf8')).toBe('outside\n')
  })

  it('絶対パスは書かない', async () => {
    expect(await gateOf().write(join(root, 'a.txt'), 'x')).toEqual({
      ok: false,
      reason: 'invalid-path'
    })
  })

  it('traversal は書かない', async () => {
    expect(await gateOf().write('sub/../../outside/victim.txt', 'x')).toEqual({
      ok: false,
      reason: 'invalid-path'
    })
  })

  it('途中に無いディレクトリがあれば書かない', async () => {
    expect(await gateOf().write('sub/deep/new.txt', 'x')).toEqual({
      ok: false,
      reason: 'missing-directory'
    })
  })

  it('hard link へは書かない', async () => {
    await link(join(root, 'a.txt'), join(root, 'sub', 'linked.txt'))

    expect(await gateOf().write('a.txt', 'x')).toEqual({ ok: false, reason: 'hard-link-write' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('Workspace の中でも、リンクを通した書き込みは拒む', async () => {
    await symlink(join(root, 'sub'), join(root, 'alias'), isWindows ? 'junction' : 'dir')
    await writeFile(join(root, 'sub', 'b.txt'), 'body\n')

    expect(await gateOf().write('alias/b.txt', 'x')).toEqual({
      ok: false,
      reason: 'aliased-target'
    })
    expect(await readFile(join(root, 'sub', 'b.txt'), 'utf8')).toBe('body\n')
  })

  it('ディレクトリへは書かない', async () => {
    expect(await gateOf().write('sub', 'x')).toEqual({ ok: false, reason: 'not-a-file' })
  })
})

describe('Secret ファイル（STEP3）', () => {
  it('.env へは書かない', async () => {
    expect(await gateOf().write('.env', 'TOKEN=changed\n')).toEqual({
      ok: false,
      reason: 'secret-file'
    })
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('TOKEN=abcdefghijklmnop\n')
  })

  it('.env の Diff は作らない（Renderer にも出さない）', async () => {
    await gateOf().write('.env', 'TOKEN=changed\n')

    expect(proposals).toEqual([])
  })

  it('新しく .env を作ることもできない', async () => {
    expect(await gateOf().write('sub/.env', 'TOKEN=x\n')).toEqual({
      ok: false,
      reason: 'secret-file'
    })
  })

  it('普通のソースは、中身に Secret があっても書ける（Diff で伏せる）', async () => {
    const outcome = await gateOf().write(
      'sub/config.ts',
      'export const key = "sk-ant-api03-abcdefghijklmnopqrstuvwx"\n'
    )

    expect(outcome.ok).toBe(true)
    expect(proposals[0].diff.secretMasked).toBe(true)
    expect(JSON.stringify(proposals[0].diff)).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')

    // 実際に書かれるのは伏せる前の本文。
    expect(await readFile(join(root, 'sub', 'config.ts'), 'utf8')).toContain(
      'sk-ant-api03-abcdefghijklmnopqrstuvwx'
    )
  })
})

describe('Diff', () => {
  it('既存ファイルは、今の中身と提案された中身を比べる', async () => {
    await gateOf().write('a.txt', 'one\nTWO\n')

    expect(proposals[0].newFile).toBe(false)
    expect(proposals[0].diff.lines.map((line) => `${line.kind}:${line.text}`)).toEqual([
      'context:one',
      'removed:two',
      'added:TWO'
    ])
  })

  it('新しいファイルは、空と提案された中身を比べる', async () => {
    await gateOf().write('sub/new.txt', 'a\nb\n')

    expect(proposals[0].newFile).toBe(true)
    expect(proposals[0].diff.lines.every((line) => line.kind === 'added')).toBe(true)
  })

  it('Workspace 相対の Path を渡す（絶対パスは渡さない）', async () => {
    await gateOf().write('sub/new.txt', 'a\n')

    expect(proposals[0].workspacePath).toBe('sub/new.txt')
    expect(JSON.stringify(proposals[0])).not.toContain(root)
  })

  it('提案が終われば、その提案の識別子で知らせる', async () => {
    await gateOf().write('a.txt', 'next\n')

    expect(settled).toEqual([proposals[0].proposalId])
  })

  it('拒まれた場合も、出した提案は必ず片付ける', async () => {
    await gateOf({
      approve: async () => ({ decision: 'denied' as const, reason: 'user-cancelled' as const })
    }).write('a.txt', 'next\n')

    expect(settled).toEqual([proposals[0].proposalId])
  })
})

describe('本文', () => {
  it('binary は書かない', async () => {
    expect(await gateOf().write('a.txt', 'a\u0000b')).toEqual({
      ok: false,
      reason: 'unsupported-content'
    })
  })

  it('大きすぎる本文は書かない', async () => {
    expect(await gateOf().write('a.txt', 'a'.repeat(1_000_001))).toEqual({
      ok: false,
      reason: 'content-too-large'
    })
  })

  it('文字列でない本文は書かない', async () => {
    expect(await gateOf().write('a.txt', { toString: () => 'x' })).toEqual({
      ok: false,
      reason: 'invalid-request'
    })
  })

  it('BOM 付きのファイルは、BOM を保ったまま書き戻す', async () => {
    await writeFile(join(root, 'bom.txt'), Buffer.from('﻿old', 'utf8'))

    expect((await gateOf().write('bom.txt', 'new')).ok).toBe(true)
    expect([...(await readFile(join(root, 'bom.txt'))).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('日本語と改行はそのまま書かれる', async () => {
    await gateOf().write('sub/ja.txt', 'あ\r\nい\n')

    expect(await readFile(join(root, 'sub', 'ja.txt'), 'utf8')).toBe('あ\r\nい\n')
  })
})

describe('承認（STEP6）', () => {
  it('承認と consume には、同じ要求を渡す', async () => {
    await gateOf().write('a.txt', 'next\n')

    expect(consumed.length).toBe(1)
    expect(consumed[0].request).toBe(approvals[0].request)
    expect(consumed[0].approvalId).toBe(approvals[0].approvalId)
  })

  it('承認に渡すのは Boundary が確かめた対象と、exact な本文', async () => {
    await gateOf().write('a.txt', 'next\n')

    const request = approvals[0].request as { kind: string; target: unknown; content: string }

    expect(request.kind).toBe('file.write')
    expect(request.content).toBe('next\n')
    expect(request.target).toHaveProperty('canonicalRelativePath', 'a.txt')
  })

  it('取り消されたら書かない', async () => {
    const outcome = await gateOf({
      approve: async () => ({ decision: 'denied' as const, reason: 'user-cancelled' as const })
    }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'user-cancelled' })
    expect(consumed).toEqual([])
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('期限切れなら書かない', async () => {
    const outcome = await gateOf({
      approve: async () => ({ decision: 'denied' as const, reason: 'approval-expired' as const })
    }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'approval-expired' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('consume が通らなければ書かない', async () => {
    const outcome = await gateOf({
      consume: () => ({ ok: false as const, reason: 'binding-mismatch' as const })
    }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'binding-mismatch' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('すでに使われた承認では書かない', async () => {
    const outcome = await gateOf({
      consume: () => ({ ok: false as const, reason: 'approval-already-used' as const })
    }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'approval-already-used' })
  })
})

describe('承認を見せている間の変化', () => {
  it('既存ファイルが書き換えられていたら書かない', async () => {
    const outcome = await gateOf({
      duringApproval: async () => {
        await writeFile(join(root, 'a.txt'), 'someone else\n')
      }
    }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'existing-file-changed' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('someone else\n')
  })

  it('対象が別のファイルへ差し替えられていたら書かない', async () => {
    const outcome = await gateOf({
      duringApproval: async () => {
        await rm(join(root, 'a.txt'))
        await writeFile(join(root, 'a.txt'), 'a different file\n')
      }
    }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'target-changed' })
    expect(consumed).toEqual([])
  })

  it('hard link を張られていたら書かない', async () => {
    const outcome = await gateOf({
      duringApproval: async () => {
        await link(join(root, 'a.txt'), join(root, 'sub', 'linked.txt'))
      }
    }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'target-changed' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('対象が消えていたら書かない', async () => {
    const outcome = await gateOf({
      duringApproval: async () => {
        await rm(join(root, 'a.txt'))
      }
    }).write('a.txt', 'next\n')

    expect(outcome.ok).toBe(false)
    expect(consumed).toEqual([])
  })

  it('新しいファイルの位置に、もうファイルができていたら作らない', async () => {
    const outcome = await gateOf({
      duringApproval: async () => {
        await writeFile(join(root, 'sub', 'new.txt'), 'someone else\n')
      }
    }).write('sub/new.txt', 'mine\n')

    expect(outcome).toEqual({ ok: false, reason: 'target-changed' })
    expect(await readFile(join(root, 'sub', 'new.txt'), 'utf8')).toBe('someone else\n')
  })

  it('親のディレクトリが消えていたら作らない', async () => {
    const outcome = await gateOf({
      duringApproval: async () => {
        await rm(join(root, 'sub'), { recursive: true })
      }
    }).write('sub/new.txt', 'mine\n')

    expect(outcome.ok).toBe(false)
    expect(consumed).toEqual([])
  })

  it('何も変わらなければ、そのまま書ける（変化の検知が空振りしない）', async () => {
    const outcome = await gateOf({
      duringApproval: async () => {
        // 対象とは関係の無い場所が変わっただけ。
        await writeFile(join(root, 'sub', 'unrelated.txt'), 'other\n')
      }
    }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: true, workspacePath: 'a.txt' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('next\n')
  })
})

describe('1件ずつ', () => {
  it('承認を待っている間に来た2件目は拒む', async () => {
    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const gate = gateOf({ duringApproval: () => held })

    const first = gate.write('a.txt', 'first\n')
    const second = await gate.write('sub/new.txt', 'second\n')

    expect(second).toEqual({ ok: false, reason: 'write-in-progress' })

    release()

    expect((await first).ok).toBe(true)
  })
})

describe('副作用の共有ロック（STEP9）', () => {
  it('Terminal が承認待ち・実行中なら、File Write は提案もしない', async () => {
    const lock = createSideEffectLock()
    const terminal = lock.acquire('terminal.run')

    const outcome = await gateOf({ lock }).write('a.txt', 'next\n')

    expect(outcome).toEqual({ ok: false, reason: 'side-effect-in-progress' })
    expect(proposals).toEqual([])
    expect(approvals).toEqual([])
    expect(events.at(-1)).toMatchObject({
      type: 'file-write.denied',
      reason: 'side-effect-in-progress'
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')

    // Terminal の側は、自分のロックを持ったまま（File Write が外していない）。
    expect(lock.heldBy()).toBe('terminal.run')

    if (terminal.ok) {
      terminal.lease.release()
    }
  })

  it('File Write の承認待ちの間は、ロックを持ち続け、終われば外す', async () => {
    const lock = createSideEffectLock()
    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = gateOf({ lock, duringApproval: () => held }).write('a.txt', 'first\n')

    // 承認を待っている間（Diff を出したところ）まで進める。
    await vi.waitFor(() => expect(approvals.length).toBe(1))
    expect(lock.acquire('terminal.run')).toEqual({ ok: false, heldBy: 'file.write' })

    release()

    expect((await first).ok).toBe(true)
    expect(lock.heldBy()).toBeNull()
  })

  it('拒否・例外のときも、ロックは外れる', async () => {
    const lock = createSideEffectLock()

    await gateOf({
      lock,
      approve: async () => ({ decision: 'denied' as const, reason: 'user-cancelled' as const })
    }).write('a.txt', 'next\n')

    expect(lock.heldBy()).toBeNull()

    const gate = createFileWriteGate({
      ...baseDeps(),
      acquireSideEffect: (kind) => lock.acquire(kind),
      resolveTarget: () => {
        throw new Error('boundary exploded')
      }
    })

    expect(await gate.write('a.txt', 'next\n')).toEqual({ ok: false, reason: 'gate-failed' })
    expect(lock.heldBy()).toBeNull()
  })

  it('ロックが取れたか分からない（例外・形が違う）なら、書かない', async () => {
    for (const acquireSideEffect of [
      () => {
        throw new Error('lock exploded')
      },
      () => ({ ok: true, lease: {} }) as unknown as SideEffectAcquireResult
    ]) {
      const gate = createFileWriteGate({ ...baseDeps(), acquireSideEffect })

      expect(await gate.write('a.txt', 'next\n')).toEqual({
        ok: false,
        reason: 'side-effect-in-progress'
      })
    }

    expect(proposals).toEqual([])
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })
})

describe('Audit（STEP4）', () => {
  it('成功したときは requested → approved → succeeded', async () => {
    await gateOf().write('a.txt', 'next\n')

    expect(eventTypes()).toEqual([
      'file-write.requested',
      'file-write.approved',
      'file-write.succeeded'
    ])
  })

  it('拒んだときは requested → denied', async () => {
    await gateOf({
      approve: async () => ({ decision: 'denied' as const, reason: 'user-cancelled' as const })
    }).write('a.txt', 'next\n')

    expect(eventTypes()).toEqual(['file-write.requested', 'file-write.denied'])
    expect(events[1]).toMatchObject({ decision: 'deny', reason: 'user-cancelled' })
  })

  it('書き込みそのものが失敗したときは failed', async () => {
    const gate = createFileWriteGate({
      ...baseDeps(),
      writeFile: async () => ({ ok: false as const, denial: 'verify-failed' as const })
    })

    expect(await gate.write('a.txt', 'next\n')).toEqual({ ok: false, reason: 'verify-failed' })
    expect(eventTypes()).toEqual([
      'file-write.requested',
      'file-write.approved',
      'file-write.failed'
    ])
    expect(events[2]).toMatchObject({ outcome: 'failure' })
  })

  it('本文・Diff・Secret・fingerprint は、どの記録にも載らない', async () => {
    await gateOf().write('a.txt', 'one\nsecret = "sk-ant-api03-abcdefghijklmnopqrstuvwx"\n')

    const recorded = JSON.stringify(events)

    expect(recorded).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')
    expect(recorded).not.toContain('one\\ntwo')
    expect(recorded).not.toMatch(/fingerprint|diff|content|approvalId|proposalId/i)
  })

  it('Workspace 相対の Path だけを載せる（絶対パスは載せない）', async () => {
    await gateOf().write('sub/new.txt', 'a\n')

    expect(events[0]).toMatchObject({ subject: 'sub/new.txt', workspacePath: 'sub/new.txt' })
    expect(JSON.stringify(events)).not.toContain(root)
  })

  it('記録が失敗しても、結論は変わらない', async () => {
    const gate = createFileWriteGate({
      ...baseDeps(),
      recordEvent: () => {
        throw new Error('audit is unavailable')
      }
    })

    expect((await gate.write('a.txt', 'next\n')).ok).toBe(true)
  })
})

/*
  求めた側（Agent の作業）の signal（2026-09-24 の修正）。以前はロックを取った後・承認を
  求める前に止めると、止めた時点では承認が無いため取り消されず、その後で承認が作られていた。
*/
describe('求めた側が止まったとき（停止・Workspace の切り替え）', () => {
  it('止まった後に呼ばれたら、ロックも取らず・Diff も承認も出さずに断る', async () => {
    const inner = createSideEffectLock()
    let acquired = 0
    const lock: SideEffectLock = {
      acquire: (kind) => {
        acquired += 1
        return inner.acquire(kind)
      },
      heldBy: inner.heldBy
    }
    const controller = new AbortController()

    controller.abort()

    expect(await gateOf({ lock }).write('a.txt', 'next\n', controller.signal)).toEqual({
      ok: false,
      reason: 'agent-stopped'
    })
    expect(acquired).toBe(0)
    expect(proposals).toEqual([])
    expect(approvals).toEqual([])
    expect(eventTypes()).toEqual(['file-write.denied'])
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('ロックを取った後・承認を求める前の I/O の間に止まれば、Diff も承認も出さず、ロックを外す', async () => {
    const lock = createSideEffectLock()
    const controller = new AbortController()

    const outcome = await gateOf({
      lock,
      resolveTarget: async (relativePath) => {
        // Boundary を確かめている間に、利用者が止めた。
        expect(lock.heldBy()).toBe('file.write')
        controller.abort()

        return resolveWorkspaceTarget(root, relativePath, 'write')
      }
    }).write('a.txt', 'next\n', controller.signal)

    expect(outcome).toEqual({ ok: false, reason: 'agent-stopped' })
    expect(proposals).toEqual([])
    expect(approvals).toEqual([])
    expect(settled).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'file-write.denied', reason: 'agent-stopped' })
    expect(lock.heldBy()).toBeNull()
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('承認を求めるときに、同じ signal を渡す（待っている間の停止は Manager が失効させる）', async () => {
    const controller = new AbortController()

    await gateOf().write('a.txt', 'next\n', controller.signal)

    expect(approvalSignals).toEqual([controller.signal])
  })

  it('承認の後・使い切る前に止まれば、承認を使い切らず・書かず、ロックを外す', async () => {
    const lock = createSideEffectLock()
    const controller = new AbortController()

    const outcome = await gateOf({
      lock,
      recheckTarget: async (target) => {
        // 承認の後、書く前に確かめ直している間に止めた。
        controller.abort()

        return recheckWorkspaceTarget(target)
      }
    }).write('a.txt', 'next\n', controller.signal)

    expect(outcome).toEqual({ ok: false, reason: 'agent-stopped' })
    expect(approvals).toHaveLength(1)
    expect(consumed).toEqual([])
    expect(eventTypes()).not.toContain('file-write.approved')
    expect(lock.heldBy()).toBeNull()
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('signal を渡さない呼び出しは、これまでどおり承認を通して書く', async () => {
    expect(await gateOf().write('a.txt', 'next\n')).toEqual({ ok: true, workspacePath: 'a.txt' })
    expect(approvalSignals).toEqual([undefined])
  })
})

describe('迂回できない', () => {
  it('Renderer へ知らせられなければ、承認へ進まない', async () => {
    const gate = createFileWriteGate({
      ...baseDeps(),
      notifyProposed: () => {
        throw new Error('no window')
      }
    })

    expect(await gate.write('a.txt', 'next\n')).toEqual({
      ok: false,
      reason: 'window-unavailable'
    })
    expect(approvals).toEqual([])
  })

  it('例外が出ても書かない', async () => {
    const gate = createFileWriteGate({
      ...baseDeps(),
      resolveTarget: () => {
        throw new Error('boundary exploded')
      }
    })

    expect(await gate.write('a.txt', 'next\n')).toEqual({ ok: false, reason: 'gate-failed' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('Boundary が作ったものでない対象は先へ進めない', async () => {
    const gate = createFileWriteGate({
      ...baseDeps(),
      resolveTarget: async () => ({
        ok: true as const,
        target: {
          access: 'write',
          canonicalRelativePath: 'a.txt',
          realPath: join(root, 'a.txt'),
          aliased: false,
          state: { kind: 'file', linkCount: 1n }
        } as unknown as VerifiedWorkspaceTarget
      })
    })

    expect(await gate.write('a.txt', 'next\n')).toEqual({ ok: false, reason: 'invalid-request' })
  })
})

/** 既定の道具一式（一部だけ差し替えるとき用）。 */
function baseDeps(): FileWriteGateDependencies {
  return {
    readPolicy: () => ({ permissionMode: 'ask' }),
    recordEvent: (event) => {
      events.push(event)
    },
    resolveTarget: (relativePath) => resolveWorkspaceTarget(root, relativePath, 'write'),
    recheckTarget: (target: VerifiedWorkspaceTarget) => recheckWorkspaceTarget(target),
    readCurrent: readCurrentFile,
    writeFile: writeConfirmedFile,
    requestApproval: async (request) => {
      approvals.push({ request, approvalId: 'approval-1' })

      return Object.freeze({
        decision: 'approved' as const,
        approvalId: 'approval-1',
        summary: {
          actionKind: 'file.write' as const,
          subject: 'x',
          workspacePath: 'x',
          commandSummary: null
        }
      })
    },
    consumeApproval: (approvalId, request) => {
      consumed.push({ approvalId, request })

      return OK_CONSUME
    },
    notifyProposed: (notice) => {
      proposals.push(notice)
    },
    notifySettled: (proposalId) => {
      settled.push(proposalId)
    },
    createProposalId: () => 'proposal-1',
    acquireSideEffect: createSideEffectLock().acquire
  }
}
