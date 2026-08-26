import { describe, expect, it } from 'vitest'
import { normalizeGitCommitHash } from './gitCommitHash'

/**
 * 短い commit hash の入口（Session 3-8-12）。
 *
 * ここが通した文字列だけが `--end-of-options` の後ろの引数として git へ渡る
 * （main/git/gitCommands.ts）。固定したいのは「rev 表記が1つも書けない」ことに
 * なる ── 通る形が16進の並びだけであれば、`HEAD~5` も `:/要約` も
 * `HEAD:path` も、引数になる経路そのものが無い。
 */
describe('normalizeGitCommitHash', () => {
  it('16進の並びをそのまま通す', () => {
    expect(normalizeGitCommitHash('abc1234')).toBe('abc1234')
    expect(normalizeGitCommitHash('0123456789abcdef0123456789abcdef01234567')).toBe(
      '0123456789abcdef0123456789abcdef01234567'
    )
  })

  it('git の rev 表記は1つも通さない', () => {
    for (const rev of [
      'HEAD',
      'HEAD~5',
      'HEAD^',
      'main',
      'main@{1}',
      '@{-1}',
      ':/直した',
      'abc1234:src/index.ts',
      'abc1234^{tree}',
      'abc1234..def5678'
    ]) {
      expect(normalizeGitCommitHash(rev), rev).toBeNull()
    }
  })

  it('オプションに読まれうる形を通さない', () => {
    expect(normalizeGitCommitHash('--upload-pack=calc')).toBeNull()
    expect(normalizeGitCommitHash('-abc1234')).toBeNull()
  })

  it('大文字は通さない（画面に出ていた文字列だけを通す）', () => {
    expect(normalizeGitCommitHash('ABC1234')).toBeNull()
    expect(normalizeGitCommitHash('Abc1234')).toBeNull()
  })

  it('短すぎる／長すぎる並びを通さない', () => {
    expect(normalizeGitCommitHash('abc')).toBeNull()
    expect(normalizeGitCommitHash('a'.repeat(41))).toBeNull()
    // SHA-256 の完全な hash（64 桁）も、この欄には届かない形になる。
    expect(normalizeGitCommitHash('0'.repeat(64))).toBeNull()
  })

  it('前後の空白を直してまで通さない', () => {
    expect(normalizeGitCommitHash(' abc1234')).toBeNull()
    expect(normalizeGitCommitHash('abc1234\n')).toBeNull()
  })

  it('文字列でない値・空を通さない', () => {
    expect(normalizeGitCommitHash('')).toBeNull()
    expect(normalizeGitCommitHash(undefined)).toBeNull()
    expect(normalizeGitCommitHash(null)).toBeNull()
    expect(normalizeGitCommitHash(1234567)).toBeNull()
    expect(normalizeGitCommitHash(['abc1234'])).toBeNull()
  })
})
