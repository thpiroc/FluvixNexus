import { describe, expect, it } from 'vitest'
import {
  GIT_COMMIT_MESSAGE_MAX_LENGTH,
  findGitCommitMessageProblem,
  normalizeGitCommitMessage,
  prepareGitCommitMessage
} from './commitMessage'

/**
 * Commit メッセージの規則（Session 3-8-4）。
 *
 * ここで固定するのは「どの文字列を通すか」だけになる。通した文字列を
 * **git がどう受け取るか**（日本語がそのまま記録されるか・`#` で始まる行が
 * 消えないか・改行が保たれるか）は、実際の git に対するテストの担当にあたる
 * （main/git/gitCommitRepository.test.ts）。
 *
 * この関数は Main と Renderer の両方が呼ぶ ── 片方だけが通す形になった瞬間、
 * 「ボタンは押せるのに Main が弾く」が生まれる。
 */
describe('prepareGitCommitMessage', () => {
  it('CRLF を LF に揃える', () => {
    expect(prepareGitCommitMessage('要約\r\n\r\n本文')).toBe('要約\n\n本文')
  })

  it('CR だけの改行も LF に揃える', () => {
    expect(prepareGitCommitMessage('要約\r本文')).toBe('要約\n本文')
  })

  it('前後の空白と改行を落とす', () => {
    expect(prepareGitCommitMessage('\n\n  要約  \n\n')).toBe('要約')
  })

  it('途中の空行は落とさない（要約と本文を分ける空行はメッセージの一部）', () => {
    expect(prepareGitCommitMessage('要約\n\n本文\n\n続き')).toBe('要約\n\n本文\n\n続き')
  })
})

describe('findGitCommitMessageProblem', () => {
  it('空文字を拒む', () => {
    expect(findGitCommitMessageProblem('')).toBe('empty')
  })

  it('普通のメッセージは通る', () => {
    expect(findGitCommitMessageProblem('fix: 不具合を直す')).toBeNull()
  })

  it('上限ちょうどは通る', () => {
    expect(findGitCommitMessageProblem('a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH))).toBeNull()
  })

  it('上限を1文字でも超えたら拒む', () => {
    expect(findGitCommitMessageProblem('a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH + 1))).toBe(
      'too-long'
    )
  })

  it('NUL を拒む', () => {
    expect(findGitCommitMessageProblem('fix\u0000ed')).toBe('invalid-characters')
  })

  it('その他の制御文字も拒む', () => {
    expect(findGitCommitMessageProblem('fix\u0007ed')).toBe('invalid-characters')
    expect(findGitCommitMessageProblem('fix\u001bed')).toBe('invalid-characters')
    expect(findGitCommitMessageProblem('fix\u007fed')).toBe('invalid-characters')
  })

  it('改行とタブは通す（本文とインデントに要る）', () => {
    expect(findGitCommitMessageProblem('要約\n\n- 項目\n\t続き')).toBeNull()
  })

  /*
    空白だけの長い文字列で「長すぎます」と言っても、直すべきところが伝わらない。
    揃えた後は空になるので、長さより先に空として扱われる。
  */
  it('空白だけの長い文字列は、長さではなく空として扱う', () => {
    const message = ' '.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH + 100)

    expect(findGitCommitMessageProblem(prepareGitCommitMessage(message))).toBe('empty')
  })
})

describe('normalizeGitCommitMessage', () => {
  it('通る文字列は揃えた形で返る', () => {
    expect(normalizeGitCommitMessage('  要約\r\n本文  ')).toBe('要約\n本文')
  })

  it('日本語をそのまま通す', () => {
    expect(normalizeGitCommitMessage('日本語のコミットメッセージ')).toBe(
      '日本語のコミットメッセージ'
    )
  })

  it('引用符・バックスラッシュ・先頭の - をそのまま通す', () => {
    expect(normalizeGitCommitMessage('-m "quoted" \'single\' back\\slash')).toBe(
      '-m "quoted" \'single\' back\\slash'
    )
  })

  it('`#` で始まるメッセージを通す（git 側は --cleanup=whitespace で消さない）', () => {
    expect(normalizeGitCommitMessage('#123 の修正')).toBe('#123 の修正')
  })

  it('空文字を拒む', () => {
    expect(normalizeGitCommitMessage('')).toBeNull()
  })

  it('空白だけを拒む', () => {
    expect(normalizeGitCommitMessage('   ')).toBeNull()
    expect(normalizeGitCommitMessage('\n\n')).toBeNull()
    expect(normalizeGitCommitMessage('\t \r\n ')).toBeNull()
  })

  it('前後の空白を落とした結果が上限に収まれば通る', () => {
    const message = `  ${'a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH)}  `

    expect(normalizeGitCommitMessage(message)).toBe('a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH))
  })

  it('上限を超えたら拒む', () => {
    expect(normalizeGitCommitMessage('a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH + 1))).toBeNull()
  })

  it('NUL を含む文字列を拒む', () => {
    expect(normalizeGitCommitMessage('fix\u0000')).toBeNull()
  })

  /** 契約の上では文字列で届くが、境界の外から来た値として素直に信じない。 */
  it('文字列でない値を拒む', () => {
    expect(normalizeGitCommitMessage(undefined)).toBeNull()
    expect(normalizeGitCommitMessage(null)).toBeNull()
    expect(normalizeGitCommitMessage(123)).toBeNull()
    expect(normalizeGitCommitMessage(['fix'])).toBeNull()
    expect(normalizeGitCommitMessage({ message: 'fix' })).toBeNull()
  })
})
