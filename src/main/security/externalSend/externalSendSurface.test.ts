import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import * as auditModule from './externalSendAudit'
import * as contextModule from './externalSendContext'
import * as decisionModule from './externalSendDecision'
import * as gateModule from './externalSendGate'
import * as payloadModule from './safeExternalPayload'
import * as workspaceModule from './workspaceFileContext'

/**
 * External Send Gate を迂回できないこと（Security Core v1 の STEP5）。
 *
 * securityPolicySurface（STEP1）・boundarySurface（STEP2）・secretSurface（STEP3）・
 * auditSurface（STEP4）と同じく、公開する名前を**一覧で固定**する。名前を足すときは
 * このテストも書き換えることになり、「それは Gate を迂回できる口ではないか」を
 * 見直す機会が必ず生まれる。
 */

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    getPath: () => ''
  }
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const externalSendApi = await import('./index')
const currentModule = await import('./currentExternalSendGate')

/** Gate を迂回できる・未検査のまま送れる口に見える名前。 */
const FORBIDDEN_NAME =
  /unsafe|bypass|skip|disable|override|force|trust|assume|unchecked|insecure|allowAll|grant|raw(?:Payload|Send|Context|Prompt)|alreadySanitized|markSafe|asSafe|toSafe|fakeSafe|plainText|secretValue|rawSecret|credential|apiKey|unmask|unredact|reveal/i

const DIRECTORY = join(__dirname)

function sourceFiles(): readonly string[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
}

describe('公開する名前', () => {
  it('External Send Gate の入口', () => {
    expect(Object.keys(externalSendApi).sort()).toEqual([
      'EXTERNAL_CONTEXT_KINDS',
      'EXTERNAL_PROVIDER_ID_MAX_LENGTH',
      'EXTERNAL_SEND_ITEM_MAX_CHARS',
      'EXTERNAL_SEND_LABEL_MAX_LENGTH',
      'EXTERNAL_SEND_MAX_ITEMS',
      'EXTERNAL_SEND_TOTAL_MAX_CHARS',
      'isSafeExternalPayload',
      'sendThroughExternalGate',
      'workspaceFileContext'
    ])
  })

  it('内部の module も、決めた名前しか公開しない', () => {
    expect(Object.keys(contextModule).sort()).toEqual([
      'EXTERNAL_CONTEXT_KINDS',
      'EXTERNAL_PROVIDER_ID_MAX_LENGTH',
      'EXTERNAL_SEND_ITEM_MAX_CHARS',
      'EXTERNAL_SEND_LABEL_MAX_LENGTH',
      'EXTERNAL_SEND_MAX_ITEMS',
      'EXTERNAL_SEND_TOTAL_MAX_CHARS',
      'isExternalContextKind',
      'isExternalProviderId'
    ])
    expect(Object.keys(decisionModule).sort()).toEqual([
      'EXTERNAL_SEND_ALLOWED_REASON',
      'decideExternalSend'
    ])
    expect(Object.keys(payloadModule).sort()).toEqual([
      'isSafeExternalPayload',
      'issueSafeExternalPayload',
      'revokeSafeExternalPayload'
    ])
    expect(Object.keys(gateModule).sort()).toEqual(['createExternalSendGate'])
    expect(Object.keys(auditModule).sort()).toEqual(['externalSendAuditEvent'])
    expect(Object.keys(workspaceModule).sort()).toEqual(['workspaceFileContext'])
    expect(Object.keys(currentModule).sort()).toEqual(['sendThroughExternalGate'])
  })

  it('externalSend フォルダのどのファイルも、迂回できる名前を export していない', () => {
    expect(sourceFiles()).toEqual([
      'currentExternalSendGate.ts',
      'externalSendAudit.ts',
      'externalSendContext.ts',
      'externalSendDecision.ts',
      'externalSendGate.ts',
      'index.ts',
      'safeExternalPayload.ts',
      'workspaceFileContext.ts'
    ])

    for (const name of sourceFiles()) {
      const exported = readFileSync(join(DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(exported.filter((line) => FORBIDDEN_NAME.test(line))).toEqual([])
    }
  })

  it('公開している定数は凍結されている', () => {
    expect(Object.isFrozen(externalSendApi.EXTERNAL_CONTEXT_KINDS)).toBe(true)
  })

  it('Safe Payload を作るだけの関数は、入口から公開していない', () => {
    expect(Object.keys(externalSendApi)).not.toContain('issueSafeExternalPayload')
    expect(Object.keys(externalSendApi)).not.toContain('decideExternalSend')
    expect(Object.keys(externalSendApi)).not.toContain('createExternalSendGate')
  })
})

describe('送る経路は1つだけ', () => {
  it('入口は「未検査の Context」と「送る手続き」の2つしか受け取らない', () => {
    expect(externalSendApi.sendThroughExternalGate.length).toBe(2)
  })

  it('Policy と Audit の差し替えは、入口からはできない', () => {
    const source = readFileSync(join(DIRECTORY, 'currentExternalSendGate.ts'), 'utf8')

    expect(source).toContain('getCurrentSecurityPolicy')
    expect(source).toContain('recordAuditEvent')
    expect(readFileSync(join(DIRECTORY, 'index.ts'), 'utf8')).not.toContain(
      'createExternalSendGate'
    )
  })

  it('Context の種類は閉じた集合', () => {
    expect([...externalSendApi.EXTERNAL_CONTEXT_KINDS]).toEqual([
      'agent-instruction',
      'error-summary',
      'mcp-read-result',
      'tool-result',
      'user-prompt',
      'workspace-file'
    ])
    expect(contextModule.isExternalContextKind('terminal-output')).toBe(false)
    expect(contextModule.isExternalContextKind('toString')).toBe(false)
  })

  it('raw な stdout / MCP の入出力・File 全文を名乗る種類は無い', () => {
    for (const kind of externalSendApi.EXTERNAL_CONTEXT_KINDS) {
      expect(kind).not.toMatch(/raw|stdout|stderr|terminal|full/i)
    }
  })
})

describe('Renderer / Preload からは届かない', () => {
  it('External Send / Provider を名乗る IPC チャンネルは無い', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    expect(channels.filter((channel) => /external|provider|prompt|sanitiz/i.test(channel))).toEqual(
      []
    )
  })

  it('Agent を名乗るのは、Main → Renderer の知らせだけ（要求の口は無い）', () => {
    /*
      STEP7 で `agent-file-write:proposed` / `:settled` が増えた。どちらも
      **Main から Renderer への片道の知らせ**で、Renderer から Main を呼ぶ
      チャンネル（IPC_CHANNELS）の側には1つも無い。
    */
    expect(Object.values(IPC_CHANNELS).filter((channel) => /agent/i.test(channel))).toEqual([])
    expect(
      Object.values(IPC_EVENT_CHANNELS)
        .filter((channel) => /agent/i.test(channel))
        .sort()
    ).toEqual(['agent-file-write:proposed', 'agent-file-write:settled'])
  })

  it('Preload は External Send を公開していない', () => {
    const preload = join(__dirname, '..', '..', '..', 'preload')
    const files = readdirSync(preload, { recursive: true, encoding: 'utf8' }).filter((name) =>
      name.endsWith('.ts')
    )

    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      expect(readFileSync(join(preload, name), 'utf8')).not.toMatch(
        /externalSend|SafeExternalPayload|sanitize/i
      )
    }
  })

  it('Main の IPC handler も External Send を受け取らない', () => {
    const handlers = join(__dirname, '..', '..', 'ipc')
    const files = readdirSync(handlers, { recursive: true, encoding: 'utf8' }).filter((name) =>
      name.endsWith('.ts')
    )

    for (const name of files) {
      expect(readFileSync(join(handlers, name), 'utf8')).not.toMatch(
        /externalSend|SafeExternalPayload/i
      )
    }
  })

  it('Renderer にも External Send の名前は無い', () => {
    const renderer = join(__dirname, '..', '..', '..', 'renderer', 'src')
    const files = readdirSync(renderer, { recursive: true, encoding: 'utf8' }).filter(
      (name) => name.endsWith('.ts') || name.endsWith('.tsx')
    )

    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      expect(readFileSync(join(renderer, name), 'utf8')).not.toMatch(
        /externalSend|SafeExternalPayload/i
      )
    }
  })
})

describe('Provider Adapter が受け取れるもの', () => {
  it('実行時の検査は、Gate が発行したものだけを通す', () => {
    for (const value of [
      null,
      undefined,
      'payload',
      42,
      {},
      { providerId: 'anthropic', parts: [], totalChars: 0, notice: {} },
      [{ kind: 'user-prompt', text: 'a' }]
    ]) {
      expect(externalSendApi.isSafeExternalPayload(value)).toBe(false)
    }
  })

  it('Provider Credential を運ぶ欄は、Safe Payload の型にも無い', () => {
    const fields = readFileSync(join(DIRECTORY, 'safeExternalPayload.ts'), 'utf8')
      .split('\n')
      .flatMap((line) => line.match(/^\s*readonly ([A-Za-z]\w*)/)?.[1] ?? [])

    expect(fields.length).toBeGreaterThan(0)
    expect(
      fields.filter((field) =>
        /apiKey|token|authorization|credential|secretValue|header|auth/i.test(field)
      )
    ).toEqual([])
  })
})
