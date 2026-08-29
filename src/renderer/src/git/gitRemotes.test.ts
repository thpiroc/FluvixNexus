import { describe, expect, it } from 'vitest'
import type { GitRemote } from '@shared/git'
import {
  GIT_DEFAULT_REMOTE_NAME,
  INITIAL_GIT_REMOTE_LIST,
  describeGitRemoteList,
  describeGitRemoteNameProblem,
  describeGitRemoteRemoveWarning,
  describeGitRemoteTruncation,
  describeGitRemoteUrlProblem,
  toGitRemoteAddReadiness,
  toGitRemoteRemoveReadiness,
  type GitRemoteListState
} from './gitRemotes'

/**
 * remote の面の中身（gitRemotes.ts・Session 3-8-16）。
 *
 * ここで固定したいのは3つ。
 *
 *   - **押せない理由が、どの場合にも出ること**（薄いボタンだけを置かない）
 *   - **名前 → URL の順に直せること**（打っている人の目は上から下へ動く）
 *   - **行と一言を同時に出さないこと**（ブランチ・履歴・退避と同じ）
 */

function remote(name: string, label = 'github.com/o/r'): GitRemote {
  return { name, label }
}

function ready(remotes: readonly GitRemote[], truncated = false): GitRemoteListState {
  return { status: 'ready', remotes, truncated }
}

describe('describeGitRemoteList', () => {
  it('開いた直後は「取得しています」（「ありません」を先に出さない）', () => {
    expect(describeGitRemoteList(INITIAL_GIT_REMOTE_LIST)).toBe('リモートを取得しています…')
  })

  it('1件も無いときは、次の一手を含めて言う', () => {
    const notice = describeGitRemoteList(ready([]))

    expect(notice).not.toBeNull()
    expect(notice).toContain('名前と URL')
  })

  it('行が出せるなら一言は出さない', () => {
    expect(describeGitRemoteList(ready([remote('origin')]))).toBeNull()
  })

  it('取れなかった / もう操作できない状態は、それぞれ別の文になる', () => {
    expect(describeGitRemoteList({ status: 'failed', remotes: [], truncated: false })).toBe(
      'リモートの一覧を取得できませんでした。'
    )
    expect(describeGitRemoteList({ status: 'not-ready', remotes: [], truncated: false })).toBe(
      'この Workspace では Git 操作を行えなくなりました。'
    )
  })
})

describe('describeGitRemoteTruncation', () => {
  it('切れていなければ出さない', () => {
    expect(describeGitRemoteTruncation(ready([remote('origin')]))).toBeNull()
  })

  it('切れていることは黙らない', () => {
    const notice = describeGitRemoteTruncation(ready([remote('origin')], true))

    expect(notice).not.toBeNull()
    expect(notice).toContain('1')
  })

  it('一覧が出せない状態では出さない（2つの断りを重ねない）', () => {
    expect(
      describeGitRemoteTruncation({ status: 'failed', remotes: [], truncated: true })
    ).toBeNull()
  })
})

describe('toGitRemoteAddReadiness', () => {
  /*
    打つ前から「入力してください」と出るのは、まだ何も間違えていない人に
    間違いを知らせる形になる（ブランチの作成欄と同じ判断）。
  */
  it('両方が空のときは、押せないが理由も言わない', () => {
    const readiness = toGitRemoteAddReadiness('', '', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('名前と URL')
  })

  it('名前が空なら、名前の側を促す（URL の問題より先）', () => {
    const readiness = toGitRemoteAddReadiness('', 'ext::sh -c whoami', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toBe('リモート名を入力してください。')
  })

  it('名前が通ってから、URL の問題を出す', () => {
    const readiness = toGitRemoteAddReadiness('origin', 'git://github.com/o/r.git', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('https://')
  })

  it('両方が通れば押せる', () => {
    const readiness = toGitRemoteAddReadiness('origin', 'https://github.com/o/r.git', false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('origin')
  })

  /*
    押した直後にネットワークへ出ないことは、押す前に読めた方がよい ──
    「押したのに何も繋がらない」と読まれうるため（shared/ipc/contracts/git.ts）。
  */
  it('通信しないことを、押す前に言う', () => {
    const readiness = toGitRemoteAddReadiness('origin', 'https://github.com/o/r.git', false)

    expect(readiness.note).toContain('通信しません')
  })

  it('前後の空白は落として見る', () => {
    expect(
      toGitRemoteAddReadiness('  origin ', '  https://github.com/o/r.git\n', false).enabled
    ).toBe(true)
  })

  it('他の Git 操作が動いている間は押せない（理由は変わらない）', () => {
    const readiness = toGitRemoteAddReadiness('origin', 'https://github.com/o/r.git', true)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('origin')
  })

  /*
    アプリが token を `.git/config` へ書かないという判断（設計判断 7）が、
    利用者から見える形になるのはここだけになる。
  */
  it('認証情報つきの URL は、消し方が分かる文で断る', () => {
    const readiness = toGitRemoteAddReadiness('origin', 'https://token@github.com/o/r.git', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('認証情報')
  })
})

describe('toGitRemoteRemoveReadiness', () => {
  /*
    ブランチの削除で「今チェックアウト中」だけを押せなくしたような事情が、
    remote には無い（main/git/gitRemotes.ts）。
  */
  it('押す前に分かる「絶対に通らない理由」を持たない', () => {
    expect(toGitRemoteRemoveReadiness(remote('origin'), false).enabled).toBe(true)
  })

  it('他の Git 操作が動いている間だけ押せない', () => {
    expect(toGitRemoteRemoveReadiness(remote('origin'), true).enabled).toBe(false)
  })

  it('何が起きるかに名前を含める', () => {
    expect(toGitRemoteRemoveReadiness(remote('upstream'), false).note).toContain('upstream')
  })
})

describe('describeGitRemoteRemoveWarning', () => {
  it('何を消すのかを、確認の文の中に出す', () => {
    expect(describeGitRemoteRemoveWarning(remote('origin')).message).toContain('origin')
  })

  /*
    消えるのは設定と remote-tracking ref だけで、commit は失われない ──
    盛って書くと、本当に戻せない場面（退避を捨てる）の警告まで軽く読まれる。
  */
  it('盛らずに書く（コミットは失われない・登録し直せる）', () => {
    const warning = describeGitRemoteRemoveWarning(remote('origin'))

    expect(warning.note).toContain('コミットは失われません')
    expect(warning.note).toContain('登録し直せます')
    expect(warning.note).not.toContain('完全に')
  })

  it('追跡先が外れることを、押す前に言う', () => {
    expect(describeGitRemoteRemoveWarning(remote('origin')).note).toContain('追跡先')
  })
})

describe('文言', () => {
  /*
    分類そのものは shared が持ち、ここは文言だけを持つ ── どの分類にも
    文言が在ることを固定しておく（switch の抜けは型が止めるが、
    「空文字を返す枝」は止められない）。
  */
  it('名前の問題に、それぞれ具体的な文がある', () => {
    const problems = [
      'empty',
      'too-long',
      'invalid-characters',
      'invalid-shape',
      'reserved'
    ] as const

    for (const problem of problems) {
      expect(describeGitRemoteNameProblem(problem).length).toBeGreaterThan(0)
    }
  })

  it('URL の問題に、それぞれ具体的な文がある', () => {
    const problems = [
      'empty',
      'too-long',
      'invalid-characters',
      'unsupported-scheme',
      'credentials',
      'invalid-shape'
    ] as const

    for (const problem of problems) {
      expect(describeGitRemoteUrlProblem(problem).length).toBeGreaterThan(0)
    }
  })

  /*
    断られる形には危なくないものも含まれるので、「危険です」とは書かない ──
    書くのは「このアプリが受け付ける形」で、次に打つものが文の中に居るようにする。
  */
  it('通らない形の文に、通る3つの形が全部書いてある', () => {
    const note = describeGitRemoteUrlProblem('unsupported-scheme')

    expect(note).toContain('https://')
    expect(note).toContain('ssh://')
    expect(note).toContain('user@host:path')
  })

  it('`.` が使えないことを、名前の文に具体的に書く（ブランチ名との違い）', () => {
    expect(describeGitRemoteNameProblem('invalid-characters')).toContain('.')
  })
})

describe('GIT_DEFAULT_REMOTE_NAME', () => {
  /*
    `origin` は慣習の名前で、予約語ではない（shared/git/remoteName.ts）──
    初期値として置いてあるのは、1つめを足す人にとってここが
    考えるところではないため。
  */
  it('既定の名前は、そのまま押せる形になっている', () => {
    expect(
      toGitRemoteAddReadiness(GIT_DEFAULT_REMOTE_NAME, 'https://github.com/o/r.git', false).enabled
    ).toBe(true)
  })
})
