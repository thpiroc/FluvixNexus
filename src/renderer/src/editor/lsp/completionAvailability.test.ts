import { describe, expect, it } from 'vitest'
import type { LanguageServerStatus } from '@shared/lsp'
import { isTypeScriptLanguageServerReady, shouldUseLspCompletion } from './completionAvailability'

function statuses(status: LanguageServerStatus['status']): readonly LanguageServerStatus[] {
  return [
    { serverId: 'typescript', status },
    { serverId: 'python', status: 'stopped' },
    { serverId: 'csharp', status: 'stopped' }
  ]
}

describe('completionAvailability', () => {
  it('TypeScript server が ready のときだけ LSP completion を使う', () => {
    expect(isTypeScriptLanguageServerReady(statuses('ready'))).toBe(true)
    expect(shouldUseLspCompletion('typescript', statuses('ready'))).toBe(true)
    expect(shouldUseLspCompletion('javascript', statuses('ready'))).toBe(true)
  })

  it('disabled / unavailable / failed / stopped / starting では built-in fallback に戻す', () => {
    for (const status of ['disabled', 'unavailable', 'failed', 'stopped', 'starting'] as const) {
      expect(shouldUseLspCompletion('typescript', statuses(status))).toBe(false)
      expect(shouldUseLspCompletion('javascript', statuses(status))).toBe(false)
    }
  })

  it('JSON / CSS / HTML の built-in language services は LSP completion 対象にしない', () => {
    expect(shouldUseLspCompletion('json', statuses('ready'))).toBe(false)
    expect(shouldUseLspCompletion('css', statuses('ready'))).toBe(false)
    expect(shouldUseLspCompletion('html', statuses('ready'))).toBe(false)
  })
})
