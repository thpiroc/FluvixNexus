import { describe, expect, it } from 'vitest'
import {
  GIT_BRANCH_NAME_MAX_LENGTH,
  findGitBranchNameProblem,
  normalizeGitBranchName,
  prepareGitBranchName
} from './branchName'

/**
 * ブランチ名の規則（Session 3-8-6）。
 *
 * この規則は **Main と Renderer の両方が同じ関数として使う**（入力中の
 * 「まだ作れない」も、IPC を渡ってきた値の検査も同じ答えになる必要がある）。
 * ここで固定しているのは、そのどちらから見ても同じであるべき境界になる。
 *
 * とくに念入りに見ているのは2つ。
 *
 *   - **先頭の `-`**。引数として git へ渡る値で、置き方の備え
 *     （`--end-of-options`）と両方から止めてある
 *   - **Windows で作れない字**。ref の実体はファイルなので、通すと
 *     「作れそうに見えて分類しにくい形で失敗する」ことになる
 */

describe('prepareGitBranchName', () => {
  it('前後の空白だけを落とす', () => {
    expect(prepareGitBranchName('  feature/x  ')).toBe('feature/x')
  })

  it('中の空白は落とさない（打った名前と作られる名前を食い違わせない）', () => {
    // 空白を含む名前は落とさずに、そのまま `invalid-characters` として断る。
    expect(prepareGitBranchName('my branch')).toBe('my branch')
    expect(findGitBranchNameProblem('my branch')).toBe('invalid-characters')
  })
})

describe('findGitBranchNameProblem', () => {
  it.each(['main', 'feature/git-branch', 'release/2026-08', 'fix.1', '日本語のブランチ', 'a'])(
    '%s は通る',
    (name) => {
      expect(findGitBranchNameProblem(name)).toBeNull()
    }
  )

  it('空は empty', () => {
    expect(findGitBranchNameProblem('')).toBe('empty')
  })

  it('上限を超えると too-long', () => {
    expect(findGitBranchNameProblem('a'.repeat(GIT_BRANCH_NAME_MAX_LENGTH))).toBeNull()
    expect(findGitBranchNameProblem('a'.repeat(GIT_BRANCH_NAME_MAX_LENGTH + 1))).toBe('too-long')
  })

  it.each([
    ['空白', 'my branch'],
    ['タブ', 'my\tbranch'],
    ['チルダ', 'a~1'],
    ['キャレット', 'a^1'],
    ['コロン', 'a:b'],
    ['疑問符', 'a?b'],
    ['アスタリスク', 'a*b'],
    ['角括弧', 'a[b'],
    ['バックスラッシュ', 'a\\b'],
    ['二重引用符', 'a"b'],
    ['山括弧', 'a<b'],
    ['縦棒', 'a|b']
  ])('%s は invalid-characters', (_label, name) => {
    expect(findGitBranchNameProblem(name)).toBe('invalid-characters')
  })

  it('制御文字は invalid-characters', () => {
    expect(findGitBranchNameProblem(`a${String.fromCharCode(0)}b`)).toBe('invalid-characters')
    expect(findGitBranchNameProblem('a\nb')).toBe('invalid-characters')
  })

  it.each([
    ['先頭の -（オプションとして読まれうる）', '-x'],
    ['範囲の記法', 'a..b'],
    ['reflog の記法', 'a@{1}'],
    ['先頭の /', '/a'],
    ['末尾の /', 'a/'],
    ['空の階層', 'a//b'],
    ['末尾のドット', 'a.'],
    ['先頭がドットの階層', 'a/.b'],
    ['.lock 終わり', 'a.lock'],
    ['階層の .lock 終わり', 'a/b.lock']
  ])('%s は invalid-shape', (_label, name) => {
    expect(findGitBranchNameProblem(name)).toBe('invalid-shape')
  })

  it.each(['HEAD', '@'])('%s は reserved', (name) => {
    expect(findGitBranchNameProblem(name)).toBe('reserved')
  })

  /**
   * 分類の順番。
   *
   * 空白だけの長い文字列を「長すぎます」と言っても、直すところが伝わらない
   * （commitMessage.ts と同じ判断）。
   */
  it('空を長さより先に見る', () => {
    expect(findGitBranchNameProblem(prepareGitBranchName('   '))).toBe('empty')
  })
})

describe('normalizeGitBranchName', () => {
  it('通る名前は揃えた形で返る', () => {
    expect(normalizeGitBranchName('  feature/x ')).toBe('feature/x')
  })

  it('通らない名前は null', () => {
    expect(normalizeGitBranchName('-x')).toBeNull()
    expect(normalizeGitBranchName('a b')).toBeNull()
    expect(normalizeGitBranchName('')).toBeNull()
  })

  /** 境界の外から来た値として素直に信じない（他の normalize と同じ構え）。 */
  it.each([[undefined], [null], [42], [{ name: 'main' }], [['main']]])(
    '文字列でない値（%s）は null',
    (raw) => {
      expect(normalizeGitBranchName(raw)).toBeNull()
    }
  )
})
