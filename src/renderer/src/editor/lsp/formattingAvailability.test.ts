import { describe, expect, it } from 'vitest'
import type { LanguageServerStatus } from '@shared/lsp'
import { shouldUseLspFormatting } from './formattingAvailability'

function statuses(status: LanguageServerStatus['status']): readonly LanguageServerStatus[] {
  return [
    { serverId: 'typescript', status },
    { serverId: 'python', status: 'stopped' },
    { serverId: 'csharp', status: 'stopped' }
  ]
}

describe('formattingAvailability', () => {
  it('TypeScript server が ready のときだけ LSP formatting を使う', () => {
    expect(shouldUseLspFormatting('typescript', statuses('ready'))).toBe(true)
    expect(shouldUseLspFormatting('javascript', statuses('ready'))).toBe(true)
  })

  it('disabled / unavailable / failed / stopped / starting では built-in fallback に戻す', () => {
    for (const status of ['disabled', 'unavailable', 'failed', 'stopped', 'starting'] as const) {
      expect(shouldUseLspFormatting('typescript', statuses(status))).toBe(false)
      expect(shouldUseLspFormatting('javascript', statuses(status))).toBe(false)
    }
  })

  it('JSON / CSS / HTML の built-in formatting は LSP formatting 対象にしない', () => {
    expect(shouldUseLspFormatting('json', statuses('ready'))).toBe(false)
    expect(shouldUseLspFormatting('css', statuses('ready'))).toBe(false)
    expect(shouldUseLspFormatting('html', statuses('ready'))).toBe(false)
  })
})
