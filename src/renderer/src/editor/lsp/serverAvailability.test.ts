import { describe, expect, it } from 'vitest'
import type { LanguageServerStatus } from '@shared/lsp'
import {
  isLanguageServerReadyFor,
  isTypeScriptWorkerLanguage,
  resolveLanguageServerIdFor
} from './serverAvailability'

function statuses(
  overrides: Partial<Record<LanguageServerStatus['serverId'], LanguageServerStatus['status']>>
): readonly LanguageServerStatus[] {
  return [
    { serverId: 'typescript', status: overrides.typescript ?? 'stopped' },
    { serverId: 'python', status: overrides.python ?? 'stopped' },
    { serverId: 'csharp', status: overrides.csharp ?? 'stopped' }
  ]
}

describe('resolveLanguageServerIdFor', () => {
  it('TypeScript / JavaScript は1本のサーバが見る', () => {
    expect(resolveLanguageServerIdFor('typescript')).toBe('typescript')
    expect(resolveLanguageServerIdFor('javascript')).toBe('typescript')
  })

  it('Python は python サーバ（Session 5-10）', () => {
    expect(resolveLanguageServerIdFor('python')).toBe('python')
  })

  it('C# はまだ載せていない（Session 5-11）', () => {
    expect(resolveLanguageServerIdFor('csharp')).toBeNull()
  })

  it('内蔵の言語サービスがあるものは LSP へ向けない', () => {
    for (const languageId of ['json', 'css', 'html', 'markdown', 'plaintext']) {
      expect(resolveLanguageServerIdFor(languageId)).toBeNull()
    }
  })
})

describe('isLanguageServerReadyFor', () => {
  it('担当サーバが ready のときだけ true', () => {
    expect(isLanguageServerReadyFor('python', statuses({ python: 'ready' }))).toBe(true)
    expect(isLanguageServerReadyFor('typescript', statuses({ typescript: 'ready' }))).toBe(true)
    expect(isLanguageServerReadyFor('javascript', statuses({ typescript: 'ready' }))).toBe(true)
  })

  it('サーバごとに独立している（片方が落ちても、もう片方は使える）', () => {
    const onlyPython = statuses({ python: 'ready', typescript: 'failed' })

    expect(isLanguageServerReadyFor('python', onlyPython)).toBe(true)
    expect(isLanguageServerReadyFor('typescript', onlyPython)).toBe(false)

    const onlyTypeScript = statuses({ typescript: 'ready', python: 'unavailable' })

    expect(isLanguageServerReadyFor('typescript', onlyTypeScript)).toBe(true)
    expect(isLanguageServerReadyFor('python', onlyTypeScript)).toBe(false)
  })

  it('ready 以外はすべて false', () => {
    for (const status of ['disabled', 'unavailable', 'failed', 'stopped', 'starting'] as const) {
      expect(isLanguageServerReadyFor('python', statuses({ python: status }))).toBe(false)
    }
  })

  it('状態がまだ届いていなければ false', () => {
    expect(isLanguageServerReadyFor('python', [])).toBe(false)
  })

  it('担当サーバの無い言語は、どのサーバが ready でも false', () => {
    const allReady = statuses({ typescript: 'ready', python: 'ready', csharp: 'ready' })

    for (const languageId of ['json', 'css', 'html', 'markdown', 'csharp']) {
      expect(isLanguageServerReadyFor(languageId, allReady)).toBe(false)
    }
  })
})

describe('isTypeScriptWorkerLanguage', () => {
  it('内蔵の TypeScript worker が答えられるのは2つだけ', () => {
    expect(isTypeScriptWorkerLanguage('typescript')).toBe(true)
    expect(isTypeScriptWorkerLanguage('javascript')).toBe(true)
  })

  it('Python は内蔵の落とし先を持たない（.py を TypeScript として解析させない）', () => {
    expect(isTypeScriptWorkerLanguage('python')).toBe(false)
  })

  it('その他の言語も worker へは渡さない', () => {
    for (const languageId of ['json', 'css', 'html', 'markdown', 'csharp', 'plaintext']) {
      expect(isTypeScriptWorkerLanguage(languageId)).toBe(false)
    }
  })
})
