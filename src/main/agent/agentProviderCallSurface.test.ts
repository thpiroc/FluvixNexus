import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'

/**
 * Provider の呼び出しの境界の置き場所（Security Core v1 の STEP10-2）。
 *
 * - `AgentProvider.next` を呼ぶのは agentProviderCall.ts だけ（Agent Loop も直に await しない）
 * - Provider・Payload・signal・応答・Credential へ Renderer から届く IPC / Preload の口は無い
 * - 境界は HTTP・SDK・Credential を持たない（実 Provider は STEP10 後半）
 */

const SRC = join(__dirname, '..', '..')
const AGENT = join(__dirname)

/** 説明文を落として、コードだけを読む。 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }

    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

function relativeOf(path: string): string {
  return relative(SRC, path).split(sep).join('/')
}

describe('next を呼ぶ場所', () => {
  it('Main の中で Provider の next を呼ぶのは agentProviderCall.ts だけ', () => {
    const callers = sourceFiles(join(SRC, 'main'))
      .filter((file) =>
        /\bprovider\.next\b|\.next\.call\(|\bnext\.call\(/.test(codeOf(readFileSync(file, 'utf8')))
      )
      .map(relativeOf)

    expect(callers).toEqual(['main/agent/agentProviderCall.ts'])
  })

  it('Agent Loop は callAgentProvider を通して Provider を呼ぶ', () => {
    const loop = codeOf(readFileSync(join(AGENT, 'agentLoop.ts'), 'utf8'))

    expect(loop).toMatch(/callAgentProvider\(/)
    expect(loop).not.toMatch(/\.next\(/)
  })

  it('境界は HTTP・SDK・Credential・Electron・fs に触れない', () => {
    const boundary = codeOf(readFileSync(join(AGENT, 'agentProviderCall.ts'), 'utf8'))

    expect(boundary).not.toMatch(
      /from '(electron|fs|fs\/promises|http|https|net|child_process|node:[^']+)'|fetch\(|safeStorage|apiKey|api_key|credential|authorization/i
    )

    const imports = [...boundary.matchAll(/from '([^']+)'/g)].map((match) => match[1]).sort()

    expect(imports).toEqual(['../security/externalSend/safeExternalPayload', './agentProvider'])
  })
})

describe('Renderer から届かない', () => {
  /*
    STEP10-5 で API Key を**入れる向き**の3本（設定済みか・設定・削除）だけが増えた。Provider を
    呼ぶ・Payload を渡す・Key を取り出すチャンネルは今も無い（aiProviderCredentialSurface.test.ts）。
  */
  it('Provider を名乗る IPC チャンネルは、API Key を入れる向きの3本だけ', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    expect(
      channels.filter((channel) => /provider|credential|payload/i.test(channel)).sort()
    ).toEqual([
      'ai-provider:delete-credential',
      'ai-provider:has-credential',
      'ai-provider:set-credential'
    ])
    expect(channels.filter((channel) => /payload/i.test(channel))).toEqual([])
  })

  it('Preload・IPC handler・Renderer・shared は Provider の境界と契約を読まない', () => {
    const outside = [
      ...sourceFiles(join(SRC, 'preload')),
      ...sourceFiles(join(SRC, 'main', 'ipc')),
      ...sourceFiles(join(SRC, 'renderer')),
      ...sourceFiles(join(SRC, 'shared'))
    ]

    const offenders = outside
      .filter((file) =>
        /agentProviderCall|callAgentProvider|agentProvider'|AgentProviderCallPolicy|AgentProviderRetryPolicy|AgentProviderError|AGENT_PROVIDER_(CALL|RETRY)_POLICY|SafeExternalPayload/.test(
          codeOf(readFileSync(file, 'utf8'))
        )
      )
      .map(relativeOf)

    expect(offenders).toEqual([])
  })
})

describe('Renderer へ見せる終わりの理由（STEP10-3）', () => {
  /** shared の AgentTaskEndReason の union を、ソースから読む。 */
  function endReasons(): string[] {
    const source = codeOf(readFileSync(join(SRC, 'shared', 'agent', 'agentTask.ts'), 'utf8'))
    const block = /export type AgentTaskEndReason =([\s\S]*?)\n\n/.exec(source)?.[1] ?? ''

    return [...block.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]).sort()
  }

  it('閉じた集合で、Provider の失敗は timeout / 大きすぎる応答 / 認証 / 権限 / その他の5つだけ', () => {
    expect(endReasons()).toEqual([
      'agent-disabled',
      'completed',
      'context-budget-exceeded',
      'context-denied',
      'internal-error',
      'loop-limit-declined',
      'provider-authentication-failed',
      'provider-authorization-failed',
      'provider-failed',
      'provider-response-too-large',
      'provider-timeout',
      'too-many-invalid-actions',
      'user-stopped',
      'workspace-changed'
    ])
  })

  it('既存の状態の通知だけで届く（agent-task の IPC は増えていない）', () => {
    expect(
      [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]
        .filter((channel) => channel.startsWith('agent'))
        .sort()
    ).toEqual([
      'agent-file-write:proposed',
      'agent-file-write:settled',
      'agent-task:continue',
      'agent-task:get-state',
      'agent-task:start',
      'agent-task:state-changed',
      'agent-task:stop',
      'agent-terminal:proposed',
      'agent-terminal:settled'
    ])
  })

  it('Preload の agentTask は増えていない（Credential・Provider の API は無い）', () => {
    const preload = codeOf(readFileSync(join(SRC, 'preload', 'api', 'agentTask.ts'), 'utf8'))
    const keys = [...preload.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]).sort()

    expect(keys).toEqual(['continueTask', 'getState', 'onStateChanged', 'start', 'stop'])
    expect(preload).not.toMatch(/provider|credential|apiKey|retry/i)
  })
})
