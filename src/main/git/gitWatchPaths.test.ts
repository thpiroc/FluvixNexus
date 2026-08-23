import { describe, expect, it } from 'vitest'
import { GIT_DIRECTORY_NAME, isMeaningfulGitChange, toGitWatchPath } from './gitWatchPaths'

/**
 * `.git` の中から届いたパスの扱い（Session 3-8-8）。
 *
 * 確かめているのは2つ。
 *   - OS の表記を、比較できる形へ落とせるか（`toGitWatchPath`）
 *   - その位置の変化で `git status` を1回起動する価値があるか（`isMeaningfulGitChange`）
 *
 * 後者を落とすと、通した1つが `git status` の連射に化ける（`objects/` は
 * 1回の commit で数百件になる）。逆に落としすぎると、端末での操作が
 * 手動更新まで届かない ── 3-8-7 までの状態に戻るだけで壊れはしないが、
 * このセッションの目的そのものが無くなる。
 */

describe('toGitWatchPath', () => {
  it('Windows の区切りを `/` へ揃える', () => {
    expect(toGitWatchPath('refs\\heads\\main')).toBe('refs/heads/main')
  })

  it('そのままの形も通す', () => {
    expect(toGitWatchPath('HEAD')).toBe('HEAD')
    expect(toGitWatchPath('refs/heads/feature/x')).toBe('refs/heads/feature/x')
  })

  it('先頭の `./` と末尾の区切りを落とす', () => {
    expect(toGitWatchPath('./index')).toBe('index')
    expect(toGitWatchPath('refs/heads/')).toBe('refs/heads')
  })

  it('空の値は落とす', () => {
    expect(toGitWatchPath('')).toBeNull()
    expect(toGitWatchPath('/')).toBeNull()
  })

  it('上へ抜ける形は落とす（`.git` の外を指す値をこの先へ通さない）', () => {
    expect(toGitWatchPath('../config')).toBeNull()
    expect(toGitWatchPath('refs/../../etc/passwd')).toBeNull()
    expect(toGitWatchPath('refs/./heads')).toBeNull()
  })

  it('区切りが続く形も落とす（空の区切りを黙って詰めない）', () => {
    expect(toGitWatchPath('refs//heads/main')).toBeNull()
  })

  it('桁違いに長い値は落とす', () => {
    expect(toGitWatchPath(`refs/heads/${'a'.repeat(2000)}`)).toBeNull()
  })
})

describe('isMeaningfulGitChange', () => {
  it('HEAD の変化を拾う（checkout / switch）', () => {
    expect(isMeaningfulGitChange('HEAD')).toBe(true)
  })

  it('index の変化を拾う（add / reset / commit）', () => {
    expect(isMeaningfulGitChange('index')).toBe(true)
  })

  it('ref の変化を拾う（ローカル / remote-tracking / タグ）', () => {
    expect(isMeaningfulGitChange('refs/heads/main')).toBe(true)
    expect(isMeaningfulGitChange('refs/heads/feature/nested/name')).toBe(true)
    expect(isMeaningfulGitChange('refs/remotes/origin/main')).toBe(true)
    expect(isMeaningfulGitChange('refs/tags/v1')).toBe(true)
  })

  it('まとめられた ref と設定の変化を拾う', () => {
    expect(isMeaningfulGitChange('packed-refs')).toBe(true)
    expect(isMeaningfulGitChange('config')).toBe(true)
  })

  it('途中で止まっている操作の目印を拾う', () => {
    expect(isMeaningfulGitChange('MERGE_HEAD')).toBe(true)
    expect(isMeaningfulGitChange('CHERRY_PICK_HEAD')).toBe(true)
    expect(isMeaningfulGitChange('REVERT_HEAD')).toBe(true)
    expect(isMeaningfulGitChange('REBASE_HEAD')).toBe(true)
    expect(isMeaningfulGitChange('BISECT_LOG')).toBe(true)
    expect(isMeaningfulGitChange('rebase-merge/done')).toBe(true)
    expect(isMeaningfulGitChange('rebase-apply/next')).toBe(true)
    expect(isMeaningfulGitChange('sequencer/todo')).toBe(true)
  })

  /*
    ロックは必ず捨てる。拾うと1回の書き込みが2回の変化になり、しかも
    「ロックを取った時点＝まだ何も変わっていない時点」で読みに行くことになる。
  */
  it('`.lock` は捨てる（どの階層でも）', () => {
    expect(isMeaningfulGitChange('index.lock')).toBe(false)
    expect(isMeaningfulGitChange('HEAD.lock')).toBe(false)
    expect(isMeaningfulGitChange('config.lock')).toBe(false)
    expect(isMeaningfulGitChange('packed-refs.lock')).toBe(false)
    expect(isMeaningfulGitChange('refs/heads/main.lock')).toBe(false)
  })

  it('書き込み途中の一時ファイルは捨てる', () => {
    expect(isMeaningfulGitChange('objects/tmp_obj_a1')).toBe(false)
    expect(isMeaningfulGitChange('tmp_index')).toBe(false)
  })

  /*
    ここがこのセッションの要点になる。`objects/` は1回の commit / fetch で
    数百から数万件動くため、通すと debounce の上限に張り付いたまま
    `git status` が回り続ける。
  */
  it('objects の変化は捨てる（1回の操作で桁違いの件数になる）', () => {
    expect(isMeaningfulGitChange('objects/ab/cdef0123456789')).toBe(false)
    expect(isMeaningfulGitChange('objects/pack/pack-abc.pack')).toBe(false)
    expect(isMeaningfulGitChange('objects/info/packs')).toBe(false)
  })

  it('reflog は捨てる（HEAD / refs と必ず一緒に動くため二重になる）', () => {
    expect(isMeaningfulGitChange('logs/HEAD')).toBe(false)
    expect(isMeaningfulGitChange('logs/refs/heads/main')).toBe(false)
  })

  it('状態ではないものは捨てる', () => {
    expect(isMeaningfulGitChange('ORIG_HEAD')).toBe(false)
    expect(isMeaningfulGitChange('FETCH_HEAD')).toBe(false)
    expect(isMeaningfulGitChange('COMMIT_EDITMSG')).toBe(false)
    expect(isMeaningfulGitChange('hooks/pre-commit')).toBe(false)
    expect(isMeaningfulGitChange('info/exclude')).toBe(false)
    expect(isMeaningfulGitChange('modules/sub/index')).toBe(false)
    expect(isMeaningfulGitChange('lfs/objects/aa/bb')).toBe(false)
    expect(isMeaningfulGitChange('worktrees/x/HEAD')).toBe(false)
  })

  it('知らない名前は捨てる（拾う側を数え上げてある）', () => {
    expect(isMeaningfulGitChange('SOMETHING_NEW')).toBe(false)
    expect(isMeaningfulGitChange('vendor-tool/state')).toBe(false)
  })

  it('拾うファイルと同じ名前のフォルダの中までは拾わない', () => {
    expect(isMeaningfulGitChange('config/extra')).toBe(false)
    expect(isMeaningfulGitChange('HEAD/x')).toBe(false)
  })

  it('拾うフォルダそのもの1つでは拾わない（中身が別に届く）', () => {
    expect(isMeaningfulGitChange('refs')).toBe(false)
  })
})

describe('GIT_DIRECTORY_NAME', () => {
  it('Workspace root の直下で待つ名前', () => {
    expect(GIT_DIRECTORY_NAME).toBe('.git')
  })
})
