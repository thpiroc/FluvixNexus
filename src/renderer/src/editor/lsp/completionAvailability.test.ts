import { describe, expect, it } from 'vitest'
import type { LanguageServerStatus } from '@shared/lsp'
import { shouldUseLspCompletion } from './completionAvailability'
import { isLanguageServerReadyFor } from './serverAvailability'

function statuses(status: LanguageServerStatus['status']): readonly LanguageServerStatus[] {
  return [
    { serverId: 'typescript', status },
    { serverId: 'python', status: 'stopped' },
    { serverId: 'csharp', status: 'stopped' }
  ]
}

/** Python サーバだけが ready（TypeScript は落ちている）。 */
function pythonReady(): readonly LanguageServerStatus[] {
  return [
    { serverId: 'typescript', status: 'stopped' },
    { serverId: 'python', status: 'ready' },
    { serverId: 'csharp', status: 'stopped' }
  ]
}

describe('completionAvailability', () => {
  it('TypeScript server が ready のときだけ LSP completion を使う', () => {
    expect(isLanguageServerReadyFor('typescript', statuses('ready'))).toBe(true)
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

  /* --------------------------------------------------- Python（Session 5-10） */

  it('Python server が ready なら .py の LSP completion を使う', () => {
    expect(shouldUseLspCompletion('python', pythonReady())).toBe(true)
  })

  it('サーバごとに独立している（TypeScript が落ちていても Python は使える）', () => {
    expect(shouldUseLspCompletion('typescript', pythonReady())).toBe(false)
    expect(shouldUseLspCompletion('javascript', pythonReady())).toBe(false)
    expect(shouldUseLspCompletion('python', statuses('ready'))).toBe(false)
  })

  it('Python が disabled / unavailable / failed / stopped / starting なら使わない', () => {
    for (const status of ['disabled', 'unavailable', 'failed', 'stopped', 'starting'] as const) {
      expect(
        shouldUseLspCompletion('python', [
          { serverId: 'typescript', status: 'ready' },
          { serverId: 'python', status },
          { serverId: 'csharp', status: 'stopped' }
        ])
      ).toBe(false)
    }
  })
})
