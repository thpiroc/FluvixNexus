import type { LanguageServerStatus } from '@shared/lsp'
import { describe, expect, it } from 'vitest'
import { shouldUseLspRename } from './renameAvailability'

/**
 * LSP の Rename を使うか（Session 5-9）。
 *
 * 使わないと答えた場合、Renderer は Monaco 内蔵の Rename へ落ちる。
 * したがってここで確かめたいのは「ready 以外はすべて落ちるか」になる
 * ── 起動中に本物のつもりで要求を出すと、答えが返らないまま
 * 利用者は何も起きていないように見える。
 */

function statuses(status: LanguageServerStatus['status']): readonly LanguageServerStatus[] {
  return [
    { serverId: 'typescript', status },
    { serverId: 'python', status: 'ready' }
  ]
}

describe('shouldUseLspRename', () => {
  it.each(['typescript', 'javascript'])('%s で ready なら使う', (languageId) => {
    expect(shouldUseLspRename(languageId, statuses('ready'))).toBe(true)
  })

  it.each(['disabled', 'unavailable', 'starting', 'failed', 'stopped'] as const)(
    'ready でない（%s）なら使わない',
    (status) => {
      expect(shouldUseLspRename('typescript', statuses(status))).toBe(false)
    }
  )

  it('状態が1つも届いていなければ使わない', () => {
    expect(shouldUseLspRename('typescript', [])).toBe(false)
  })

  it.each(['json', 'css', 'html', 'markdown', 'plaintext'])(
    '%s は対象外（内蔵のまま）',
    (languageId) => {
      expect(shouldUseLspRename(languageId, statuses('ready'))).toBe(false)
    }
  )

  it('別の言語のサーバが ready でも、TypeScript の Rename には使わない', () => {
    expect(
      shouldUseLspRename('typescript', [
        { serverId: 'python', status: 'ready' },
        { serverId: 'typescript', status: 'stopped' }
      ])
    ).toBe(false)
  })
})
