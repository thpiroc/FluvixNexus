import { describe, expect, it } from 'vitest'
import type { LanguageServerStatus } from '@shared/lsp'
import { shouldUseLspNavigation } from './navigationAvailability'

function statuses(status: LanguageServerStatus['status']): readonly LanguageServerStatus[] {
  return [
    { serverId: 'typescript', status },
    { serverId: 'python', status: 'stopped' },
    { serverId: 'csharp', status: 'stopped' }
  ]
}

describe('navigationAvailability', () => {
  it('TypeScript server が ready のときだけ TS / JS navigation を LSP に向ける', () => {
    expect(shouldUseLspNavigation('typescript', statuses('ready'))).toBe(true)
    expect(shouldUseLspNavigation('javascript', statuses('ready'))).toBe(true)
  })

  it('disabled / unavailable / failed / stopped / starting は built-in fallback に戻す', () => {
    for (const status of ['disabled', 'unavailable', 'failed', 'stopped', 'starting'] as const) {
      expect(shouldUseLspNavigation('typescript', statuses(status))).toBe(false)
      expect(shouldUseLspNavigation('javascript', statuses(status))).toBe(false)
    }
  })

  it('JSON / CSS / HTML の built-in language services は対象にしない', () => {
    expect(shouldUseLspNavigation('json', statuses('ready'))).toBe(false)
    expect(shouldUseLspNavigation('css', statuses('ready'))).toBe(false)
    expect(shouldUseLspNavigation('html', statuses('ready'))).toBe(false)
  })
})
