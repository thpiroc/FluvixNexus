import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import * as providerModule from './openAiProvider'
import * as responsesModule from './openAiResponses'

/**
 * OpenAI の Adapter の置き場所と口（STEP10-6）。SSRF・Credential の持ち出しを防ぐ要を固定する。
 *
 * - 送り先の URL は Adapter の中の定数1つ。options・設定・環境変数・応答から変える口は無い
 * - fetch を呼ぶのは Adapter の組み立て（aiProviderRuntime.ts）だけ。Agent Loop は fetch しない
 * - SDK の依存は無い。OpenAI の built-in tools は要求に入らない
 * - Renderer / Preload に OpenAI の応答・要求・URL・Credential へ届く口は増えていない
 */

const SRC = join(__dirname, '..', '..')
const ROOT = join(SRC, '..')

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

describe('Endpoint 固定（SSRF・Credential の持ち出しを防ぐ）', () => {
  it('Adapter の options は model / fetch / withCredential / httpPolicy / now だけ（URL の欄は無い）', () => {
    const provider = read('main', 'aiProvider', 'openAiProvider.ts')
    const block =
      /export interface OpenAiProviderOptions \{([\s\S]*?)\n\}/.exec(provider)?.[1] ?? ''
    const fields = [...block.matchAll(/readonly (\w+)\??:/g)].map((match) => match[1]).sort()

    expect(fields).toEqual(['fetch', 'httpPolicy', 'model', 'now', 'withCredential'])
    expect(provider).not.toMatch(/baseUrl|base_url|proxy|customHost|hostname|endpoint\s*:/i)
  })

  it('fetch に渡る URL は定数だけ（文字列の組み立て・変数の URL は無い）', () => {
    const provider = read('main', 'aiProvider', 'openAiProvider.ts')
    const calls = [...provider.matchAll(/send\(([^,]+),/g)].map((match) => match[1].trim())

    expect(calls).toEqual(['OPENAI_RESPONSES_ENDPOINT'])
    expect(responsesModule.OPENAI_RESPONSES_ENDPOINT).toBe('https://api.openai.com/v1/responses')
  })

  it('環境変数・設定から送り先も Key も読まない', () => {
    for (const file of sourceFiles(join(SRC, 'main', 'aiProvider'))) {
      expect(codeOf(readFileSync(file, 'utf8')), relativeOf(file)).not.toMatch(/process\.env/)
    }

    const runtime = read('main', 'aiProvider', 'aiProviderRuntime.ts')

    expect(runtime).toMatch(/globalThis\.fetch\(url, init\)/)
    expect(runtime).not.toMatch(/https?:\/\/|endpoint|readEffectiveSettings|workspace/i)
  })

  it('fetch を呼ぶのは Adapter の組み立てだけ（Agent Loop・Security Core・IPC は fetch しない）', () => {
    const callers = sourceFiles(join(SRC, 'main'))
      .filter((file) => /\bfetch\(/.test(codeOf(readFileSync(file, 'utf8'))))
      .map(relativeOf)
      .filter(
        (file) =>
          file.startsWith('main/agent/') ||
          file.startsWith('main/security/') ||
          file.startsWith('main/aiProvider/') ||
          file.startsWith('main/ipc/')
      )

    expect(callers).toEqual(['main/aiProvider/aiProviderRuntime.ts'])
  })

  it('公開する名前', () => {
    expect(Object.keys(providerModule).sort()).toEqual([
      'OPENAI_CONTEXT_WINDOW_TOKENS',
      'OPENAI_PROVIDER_ID',
      'createOpenAiProvider'
    ])
  })
})

describe('SDK・built-in tools', () => {
  it('OpenAI の SDK を依存に入れていない', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {})
    ]

    expect(names.filter((name) => /openai/i.test(name))).toEqual([])

    for (const file of sourceFiles(SRC)) {
      expect(codeOf(readFileSync(file, 'utf8'))).not.toMatch(/from 'openai|from '@openai\//)
    }
  })

  it('要求に tools を入れない（Web Search・Computer Use・Hosted Shell・MCP・File Search・Code Interpreter）', () => {
    const responses = read('main', 'aiProvider', 'openAiResponses.ts')

    expect(responses).not.toMatch(
      // `file_search` は FN の Action の名前（Schema にある）なので、OpenAI の tool 名は _call 付きで見る。
      /tools\s*:|tool_choice|web_search|computer_use|code_interpreter|file_search_call|local_shell|\bshell\b|\bmcp\b|image_generation/i
    )
  })
})

describe('Renderer / Preload / IPC', () => {
  it('OpenAI の応答・要求・URL・Credential・Payload を扱うチャンネルは無い（ai-provider は3本のまま）', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    expect(
      channels.filter((channel) =>
        /openai|responses|endpoint|base-?url|payload|bypass|authorization|raw-request/i.test(
          channel
        )
      )
    ).toEqual([])
    expect(channels.filter((channel) => channel.startsWith('ai-provider:')).sort()).toEqual([
      'ai-provider:delete-credential',
      'ai-provider:has-credential',
      'ai-provider:set-credential'
    ])
  })

  it('Preload・Renderer・shared は Adapter・Endpoint・Authorization に触れない', () => {
    const outside = [
      ...sourceFiles(join(SRC, 'preload')),
      ...sourceFiles(join(SRC, 'renderer')),
      ...sourceFiles(join(SRC, 'shared'))
    ]

    const offenders = outside
      .filter((file) =>
        /openAiProvider|openAiResponses|api\.openai\.com|Authorization:|\bBearer\b|OPENAI_RESPONSES_ENDPOINT/.test(
          codeOf(readFileSync(file, 'utf8'))
        )
      )
      .map(relativeOf)

    expect(offenders).toEqual([])
  })
})
