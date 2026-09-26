import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emptySettingsSections } from '@shared/settings'
import { parseSettingsSectionUpdate, parseStoredSection } from '../store/settingsSections'
import * as storeModule from './aiProviderCredentialStore'

/**
 * AI Provider の API Key の口（STEP10-5）。
 *
 * - Renderer から使えるのは「設定済みか・設定・削除」の3つだけ。Key を返す口は無い
 * - 復号した Key を受け取れる `withCredential` は Main の Credential Store の中だけにあり、
 *   IPC・Preload・Renderer・shared・Agent Loop・Security Core のどこからも呼ばれない
 * - Endpoint を変える欄・API は無い
 *
 * 名前を足すときはこのテストも書き換えることになり、そこで見直す機会が必ず生まれる。
 */

const SRC = join(__dirname, '..', '..')

/** Key を取り出す口に見える名前。 */
const READ_BACK =
  /\b(get|read|reveal|decrypt|export|dump|show|peek|unmask)\w*(Credential|ApiKey|Key|Secret)\b/i

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

function read(...segments: string[]): string {
  return codeOf(readFileSync(join(SRC, ...segments), 'utf8'))
}

describe('IPC', () => {
  it('ai-provider のチャンネルは3本だけ（知らせも無い）', () => {
    expect(
      Object.values(IPC_CHANNELS)
        .filter((channel) => channel.startsWith('ai-provider:'))
        .sort()
    ).toEqual([
      'ai-provider:delete-credential',
      'ai-provider:has-credential',
      'ai-provider:set-credential'
    ])
    expect(
      Object.values(IPC_EVENT_CHANNELS).filter((channel) => /provider|credential/i.test(channel))
    ).toEqual([])
  })

  it('Key を取り出す・Endpoint を変えるチャンネルは無い', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    expect(
      channels
        .filter((channel) => /credential|api-?key|secret|endpoint|base-?url/i.test(channel))
        .filter((channel) => /get|read|reveal|decrypt|export|endpoint|url/i.test(channel))
    ).toEqual([])
  })

  it('要求の欄は providerId と apiKey（設定のときだけ）。応答の欄は状態・保存できるか・分類だけ', () => {
    const contract = read('shared', 'ipc', 'contracts', 'aiProvider.ts')
    // 応答の型の部分だけ（後ろの Key の形の検証は、Renderer へ返す欄ではない）。
    const credential = read('shared', 'aiProvider', 'credential.ts').split(
      'export const AI_PROVIDER_API_KEY_MAX_LENGTH'
    )[0]
    const fields = (source: string): string[] =>
      [...source.matchAll(/readonly (\w+)\??:/g)].map((match) => match[1]).sort()

    expect([...new Set(fields(contract))]).toEqual(['apiKey', 'providerId'])
    expect(contract.match(/readonly apiKey/g)).toHaveLength(1)
    expect([...new Set(fields(credential))]).toEqual([
      'canStore',
      'failure',
      'ok',
      'providerId',
      'state',
      'status'
    ])
    expect(credential).not.toMatch(/apiKey|length|prefix|suffix|masked|hint|preview/i)
  })
})

describe('Preload', () => {
  it('aiProvider は設定済みか・設定・削除の3つだけ', () => {
    const preload = read('preload', 'api', 'aiProvider.ts')
    const keys = [...preload.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]).sort()

    expect(keys).toEqual(['deleteCredential', 'hasCredential', 'setCredential'])
    expect(preload.match(/invokeIpc\(/g)).toHaveLength(3)
    expect(preload).not.toMatch(/subscribeIpcEvent|ipcRenderer|safeStorage|endpoint|baseUrl/i)
    expect(preload).not.toMatch(READ_BACK)
  })

  it('AiProviderApi の型も同じ3つ', () => {
    const api = read('shared', 'api.ts')
    const block = /export interface AiProviderApi \{([\s\S]*?)\n\}/.exec(api)?.[1] ?? ''
    const keys = [...block.matchAll(/readonly (\w+):/g)].map((match) => match[1]).sort()

    expect(keys).toEqual(['deleteCredential', 'hasCredential', 'setCredential'])
  })

  it('Preload の API 全体に、Key を取り出す名前・Credential Store へ届く名前は無い', () => {
    for (const file of sourceFiles(join(SRC, 'preload'))) {
      const code = codeOf(readFileSync(file, 'utf8'))

      expect(code).not.toMatch(READ_BACK)
      expect(code).not.toMatch(/withCredential|CredentialStore|safeStorage/)
    }
  })
})

describe('復号した Key へ届く経路', () => {
  /*
    STEP10-6：OpenAI の Adapter（openAiProvider.ts）と、それを openai の Credential に結び付ける
    aiProviderRuntime.ts が足された。どちらも Main の main/aiProvider の中。
  */
  it('withCredential を使うのは Credential Store と OpenAI の Adapter（とその組み立て）だけ', () => {
    const users = sourceFiles(SRC)
      .filter((file) => /\bwithCredential\b/.test(codeOf(readFileSync(file, 'utf8'))))
      .map(relativeOf)
      .sort()

    expect(users).toEqual([
      'main/aiProvider/aiProviderCredentialStore.ts',
      'main/aiProvider/aiProviderRuntime.ts',
      'main/aiProvider/openAiProvider.ts'
    ])
  })

  it('Credential Store・aiProvider の service を読むのは IPC handler と main/aiProvider だけ', () => {
    const importers = sourceFiles(SRC)
      .filter((file) =>
        /aiProviderCredentialStore'|aiProviderService'/.test(codeOf(readFileSync(file, 'utf8')))
      )
      .map(relativeOf)
      .sort()

    expect(importers).toEqual([
      'main/aiProvider/aiProviderRuntime.ts',
      'main/aiProvider/aiProviderService.ts',
      'main/aiProvider/openAiProvider.ts',
      'main/ipc/handlers/aiProvider.ts'
    ])
  })

  it('Agent Loop・Security Core・Renderer・shared は Credential にも safeStorage にも触れない', () => {
    const outside = [
      ...sourceFiles(join(SRC, 'main', 'agent')),
      ...sourceFiles(join(SRC, 'main', 'security')),
      ...sourceFiles(join(SRC, 'renderer')),
      ...sourceFiles(join(SRC, 'shared')),
      ...sourceFiles(join(SRC, 'preload'))
    ]

    const offenders = outside
      .filter((file) =>
        /safeStorage|withCredential|CredentialStore|aiProviderService|aiProviderRuntime|openAiProvider|openAiResponses/.test(
          codeOf(readFileSync(file, 'utf8'))
        )
      )
      .map(relativeOf)

    // Agent Loop の入口だけが、正式な Provider を作る aiProviderRuntime を読む（Key には触れない）。
    expect(offenders).toEqual(['main/agent/currentAgentLoop.ts'])

    const current = read('main', 'agent', 'currentAgentLoop.ts')

    expect([...current.matchAll(/from '([^']*aiProvider[^']*)'/g)].map((m) => m[1])).toEqual([
      '../aiProvider/aiProviderRuntime'
    ])
    expect(current).not.toMatch(/safeStorage|withCredential|CredentialStore|aiProviderService/)
  })

  it('IPC handler は状態・設定・削除だけを使う', () => {
    const handler = read('main', 'ipc', 'handlers', 'aiProvider.ts')

    expect(handler).toMatch(/\.getStatus\(/)
    expect(handler).toMatch(/\.setCredential\(/)
    expect(handler).toMatch(/\.deleteCredential\(/)
    expect(handler).not.toMatch(/withCredential|decrypt|safeStorage|ipcMain/)
  })

  it('Credential Store が公開するのは作る関数と型の定数だけ', () => {
    expect(Object.keys(storeModule).sort()).toEqual([
      'AI_PROVIDER_CREDENTIALS_FILE_NAME',
      'AI_PROVIDER_CREDENTIALS_SCHEMA_VERSION',
      'createAiProviderCredentialStore'
    ])
  })
})

describe('Renderer', () => {
  const directory = join(SRC, 'renderer', 'src', 'aiProvider')
  const sources = sourceFiles(directory).map((file) => codeOf(readFileSync(file, 'utf8')))

  it('API Key の欄は password で、ブラウザの保存にも console にも出さない', () => {
    const panel = read('renderer', 'src', 'aiProvider', 'AiProviderCredentialPanel.tsx')

    expect(panel).toMatch(/type="password"/)
    expect(panel).toMatch(/autoComplete="off"/)

    for (const code of sources) {
      expect(code).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|document\.cookie/)
      expect(code).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
    }
  })

  it('Renderer が呼ぶのは fluvix.aiProvider の3つだけ（Key を取り出す呼び出しは無い）', () => {
    const calls = sourceFiles(join(SRC, 'renderer'))
      .flatMap((file) => [
        ...codeOf(readFileSync(file, 'utf8')).matchAll(/fluvix\.aiProvider\.(\w+)/g)
      ])
      .map((match) => match[1])

    expect([...new Set(calls)].sort()).toEqual([
      'deleteCredential',
      'hasCredential',
      'setCredential'
    ])
  })
})

describe('Endpoint は設定に無い', () => {
  it('aiProvider の section が持つ key は providerId / modelId だけ', () => {
    const parsed = parseStoredSection('aiProvider', {
      providerId: 'openai',
      modelId: 'x',
      endpoint: 'https://attacker.example',
      baseUrl: 'https://attacker.example',
      apiKey: 'sk-fn-test-surface'
    })

    expect(Object.keys(parsed.value).sort()).toEqual(['modelId', 'providerId'])

    // 保存の要求では、知らない key は落ちる（書かれない）。
    expect(
      parseSettingsSectionUpdate({
        section: 'aiProvider',
        value: { providerId: 'openai', endpoint: 'https://attacker.example', apiKey: 'sk-x' }
      })
    ).toEqual({ section: 'aiProvider', value: { providerId: 'openai' } })
    expect(Object.keys(emptySettingsSections().aiProvider)).toEqual([])
  })

  it('shared・contract・Preload・Renderer・IPC の AI Provider の層に URL も Endpoint の欄も無い', () => {
    const files = [
      ...sourceFiles(join(SRC, 'shared', 'aiProvider')),
      join(SRC, 'shared', 'ipc', 'contracts', 'aiProvider.ts'),
      join(SRC, 'preload', 'api', 'aiProvider.ts'),
      ...sourceFiles(join(SRC, 'renderer', 'src', 'aiProvider')),
      join(SRC, 'main', 'ipc', 'handlers', 'aiProvider.ts'),
      join(SRC, 'main', 'aiProvider', 'aiProviderCredentialStore.ts'),
      join(SRC, 'main', 'aiProvider', 'aiProviderService.ts')
    ]

    for (const file of files) {
      const code = codeOf(readFileSync(file, 'utf8'))

      expect(code).not.toMatch(/endpoint|baseUrl|base_url|proxy|https?:\/\/|fetch\(/i)
    }
  })

  it('URL は OpenAI の Adapter の定数1つだけ（STEP10-6。openAiProviderSurface.test.ts も見る）', () => {
    const urls = sourceFiles(join(SRC, 'main', 'aiProvider')).flatMap((file) =>
      [...codeOf(readFileSync(file, 'utf8')).matchAll(/https?:\/\/[^'"`\s]+/g)].map(
        (match) => `${relativeOf(file)} ${match[0]}`
      )
    )

    expect(urls).toEqual(['main/aiProvider/openAiResponses.ts https://api.openai.com/v1/responses'])
  })
})

describe('Scripted Provider は正式 Provider の外', () => {
  it('SupportedProviderId に scripted は無く、Scripted は開発ビルドだけのまま', () => {
    expect(read('shared', 'aiProvider', 'providers.ts')).toMatch(
      /SUPPORTED_PROVIDER_IDS = \['openai'\] as const/
    )

    const current = read('main', 'agent', 'currentAgentLoop.ts')

    expect(current).toMatch(/\(isDevelopment \? createScriptedProvider\(\) : null\)/)
    expect(current).not.toMatch(/Credential|aiProviderService/)
  })
})
