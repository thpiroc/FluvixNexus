import { describe, expect, it } from 'vitest'
import type { LanguageServerStatus } from '@shared/lsp'
import { shouldUseLspHover } from './hoverAvailability'

function statuses(status: LanguageServerStatus['status']): readonly LanguageServerStatus[] {
  return [
    { serverId: 'typescript', status },
    { serverId: 'python', status: 'stopped' },
    { serverId: 'csharp', status: 'stopped' }
  ]
}

describe('hoverAvailability', () => {
  it('TypeScript server が ready のときだけ LSP hover を使う', () => {
    expect(shouldUseLspHover('typescript', statuses('ready'))).toBe(true)
    expect(shouldUseLspHover('javascript', statuses('ready'))).toBe(true)
  })

  it('disabled / unavailable / failed / stopped / starting では built-in fallback に戻す', () => {
    for (const status of ['disabled', 'unavailable', 'failed', 'stopped', 'starting'] as const) {
      expect(shouldUseLspHover('typescript', statuses(status))).toBe(false)
      expect(shouldUseLspHover('javascript', statuses(status))).toBe(false)
    }
  })

  it('JSON / CSS / HTML の built-in language services は LSP hover 対象にしない', () => {
    expect(shouldUseLspHover('json', statuses('ready'))).toBe(false)
    expect(shouldUseLspHover('css', statuses('ready'))).toBe(false)
    expect(shouldUseLspHover('html', statuses('ready'))).toBe(false)
  })

  /* --------------------------------------------------- Python（Session 5-10） */

  it('Python server が ready なら .py の LSP hover を使う', () => {
    expect(
      shouldUseLspHover('python', [
        { serverId: 'typescript', status: 'stopped' },
        { serverId: 'python', status: 'ready' },
        { serverId: 'csharp', status: 'stopped' }
      ])
    ).toBe(true)
  })

  it('Python server が ready でなければ使わない（内蔵の hover は無いので何も出ない）', () => {
    for (const status of ['disabled', 'unavailable', 'failed', 'stopped', 'starting'] as const) {
      expect(
        shouldUseLspHover('python', [
          { serverId: 'typescript', status: 'ready' },
          { serverId: 'python', status },
          { serverId: 'csharp', status: 'stopped' }
        ])
      ).toBe(false)
    }
  })
})
