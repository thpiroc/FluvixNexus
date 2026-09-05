import { describe, expect, it } from 'vitest'
import type { GitRemote } from '@shared/git'
import {
  GIT_DEFAULT_REMOTE_NAME,
  INITIAL_GIT_REMOTE_LIST,
  describeGitRemoteList,
  describeGitRemoteNameProblem,
  describeGitRemoteRemoveWarning,
  describeGitRemoteSetUrlWarning,
  describeGitRemoteTruncation,
  describeGitRemoteUrlProblem,
  toGitRemoteAddReadiness,
  toGitRemoteRemoveReadiness,
  toGitRemoteRenameReadiness,
  toGitRemoteSetUrlReadiness,
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
    expect(describeGitRemoteList(INITIAL_GIT_REMOTE_LIST)).toBe('Remote を取得しています…')
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
      'Remote の一覧を取得できませんでした。'
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
    expect(readiness.note).toBe('Remote 名を入力してください。')
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

    expect(warning.note).toContain('Commit は失われません')
    expect(warning.note).toContain('登録し直せます')
    expect(warning.note).not.toContain('完全に')
  })

  it('追跡先が外れることを、押す前に言う', () => {
    expect(describeGitRemoteRemoveWarning(remote('origin')).note).toContain('upstream')
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

/**
 * 送り先（URL）を変える欄（Session 3-8-17）。
 *
 * ここで固定したいのは、追加の欄との**違い**になる。
 *
 *   - 通す URL の規則は追加と**同じ**（分けると `ext::…` を断る根拠が半分になる）
 *   - 「今と同じ URL か」は**言えない**（Renderer は今の URL を持っていない）
 */
describe('toGitRemoteSetUrlReadiness', () => {
  it('空欄では理由を言わず、何をする欄かだけを言う', () => {
    const readiness = toGitRemoteSetUrlReadiness(remote('origin'), '', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('origin')
    expect(readiness.note).toContain('URL')
  })

  it('通る URL なら押せる', () => {
    expect(
      toGitRemoteSetUrlReadiness(remote('origin'), 'https://github.com/o/r.git', false).enabled
    ).toBe(true)
  })

  it('scp 形式も、追加の欄と同じく通る', () => {
    expect(
      toGitRemoteSetUrlReadiness(remote('origin'), 'git@github.com:o/r.git', false).enabled
    ).toBe(true)
  })

  /*
    追加の欄とまったく同じ関数（shared/git/remoteUrl.ts）を通す。
    分けると「追加では通らないが変更では通る URL」が生まれ、
    時間差で発火する任意コマンド実行の欄が2つめとして開く。
  */
  it('`ext::…` は、変更の欄でも断る', () => {
    /* 空白を含む形（実在の RCE の経路そのもの）と、含まない形の両方。 */
    expect(toGitRemoteSetUrlReadiness(remote('origin'), 'ext::sh -c whoami', false).enabled).toBe(
      false
    )

    const readiness = toGitRemoteSetUrlReadiness(remote('origin'), 'ext::sh', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toBe(describeGitRemoteUrlProblem('unsupported-scheme'))
  })

  /*
    断る理由まで追加の欄と一致することを固定する ── ずれた時点で、
    片方の欄だけが通す形が生まれたことになる。
  */
  it('断る理由が、追加の欄とまったく同じになる', () => {
    const urls = [
      'git://github.com/o/r.git',
      'http://github.com/o/r.git',
      'file:///C:/repos/x',
      'C:/repos/x',
      'ext::sh',
      'https://ghp_token@github.com/o/r.git',
      'https://github.com'
    ]

    for (const url of urls) {
      const adding = toGitRemoteAddReadiness('origin', url, false)
      const setting = toGitRemoteSetUrlReadiness(remote('origin'), url, false)

      expect(setting.enabled).toBe(false)
      expect(adding.enabled).toBe(false)
      expect(setting.note).toBe(adding.note)
    }
  })

  it('認証情報つきの URL も、変更の欄で断る', () => {
    const readiness = toGitRemoteSetUrlReadiness(
      remote('origin'),
      'https://ghp_token@github.com/o/r.git',
      false
    )

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toBe(describeGitRemoteUrlProblem('credentials'))
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(
      toGitRemoteSetUrlReadiness(remote('origin'), 'https://github.com/o/r.git', true).enabled
    ).toBe(false)
  })

  /*
    押した後に**何が起きないか**まで言う（追加の欄と同じ）── ここで
    通信すると読まれると、届かない URL を打った人が固まったと思う。
  */
  it('押す前に「通信しない」と言う', () => {
    expect(
      toGitRemoteSetUrlReadiness(remote('origin'), 'https://github.com/o/r.git', false).note
    ).toContain('通信しません')
  })
})

/**
 * 送り先を変える前の確認（Session 3-8-17）。
 *
 * Git で5つめの確認で、**失われるものが1つも無い唯一の確認**になる。
 */
describe('describeGitRemoteSetUrlWarning', () => {
  it('今どこを指していて、これからどこを指すかを別々に持つ', () => {
    const warning = describeGitRemoteSetUrlWarning(
      remote('origin', 'github.com/o/old'),
      'https://github.com/o/new.git'
    )

    expect(warning.currentLabel).toBe('github.com/o/old')
    expect(warning.nextUrl).toBe('https://github.com/o/new.git')
    expect(warning.message).toContain('origin')
  })

  /*
    出すのは**行が持っているラベル**で、URL ではない ── 3-8-16 の
    「URL は Renderer へ渡さない」は 3-8-17 でも動いていない。
  */
  it('現在の側に出るのはラベル（URL ではない）', () => {
    const warning = describeGitRemoteSetUrlWarning(
      remote('origin', 'github.com/o/r'),
      'https://github.com/o/new.git'
    )

    expect(warning.currentLabel).not.toContain('https://')
    expect(warning.currentLabel).not.toContain('.git')
  })

  /* 打った文字列は前後の空白だけ落として出す（打ったとおりを確かめる場所）。 */
  it('打った URL は前後の空白だけを落として出す', () => {
    expect(
      describeGitRemoteSetUrlWarning(remote('origin'), '  https://github.com/o/new.git  ').nextUrl
    ).toBe('https://github.com/o/new.git')
  })

  /*
    この操作でいちばん読まれにくいこと ── 手元の remote-tracking は
    前の送り先のまま残り、`↑ ↓` はしばらく別の相手と比べた数になる。
  */
  it('手元に残るもの（追跡情報が前の送り先のまま）を書く', () => {
    const note = describeGitRemoteSetUrlWarning(remote('origin'), 'https://github.com/o/n.git').note

    expect(note).toContain('前の送り先')
    expect(note).toContain('Commit は失われません')
  })

  /* 盛らない ── 本当に戻せない場面（退避を捨てる）の警告まで軽く読まれる。 */
  it('「失われます」と書かない', () => {
    const warning = describeGitRemoteSetUrlWarning(remote('origin'), 'https://github.com/o/n.git')

    expect(`${warning.message}${warning.note}`).not.toContain('失われます')
  })
})

/**
 * 名前を変える欄（Session 3-8-17）。
 *
 * ここで固定したいのは、**ブランチの rename と逆になる1点**にあたる ──
 * 大文字小文字だけの改名は、ブランチでは通り、remote では通らない。
 */
describe('toGitRemoteRenameReadiness', () => {
  it('開いた直後（今の名前のまま）は押せない', () => {
    const readiness = toGitRemoteRenameReadiness(remote('origin'), 'origin', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toBe('新しい名前を入力してください。')
  })

  it('空欄では、どの remote の話かを言う', () => {
    const readiness = toGitRemoteRenameReadiness(remote('origin'), '', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('origin')
  })

  it('別の名前なら押せて、何が起きるかを言う', () => {
    const readiness = toGitRemoteRenameReadiness(remote('origin'), 'upstream', false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('origin')
    expect(readiness.note).toContain('upstream')
  })

  /*
    行き先にも同じ規則を通す（shared/git/remoteName.ts）── `.` を含む名前も
    先頭が `-` の名前も、追加のときと同じ理由で断る。
  */
  it('行き先の名前も、追加と同じ規則で断る', () => {
    expect(toGitRemoteRenameReadiness(remote('origin'), 'a.b', false).note).toBe(
      describeGitRemoteNameProblem('invalid-characters')
    )
    expect(toGitRemoteRenameReadiness(remote('origin'), '-x', false).note).toBe(
      describeGitRemoteNameProblem('invalid-shape')
    )
  })

  /*
    ここが 3-8-14 と逆になる点。`git remote rename` に `--force` は無く、
    Windows で渡すと git は**途中まで適用したまま**落ちる ── つまり
    「押しても通らない」ではなく「押すと壊れる」になる。
  */
  it('大文字小文字だけの改名は押せない（ブランチとは逆）', () => {
    expect(toGitRemoteRenameReadiness(remote('origin'), 'Origin', false).enabled).toBe(false)
    expect(toGitRemoteRenameReadiness(remote('Origin'), 'origin', false).enabled).toBe(false)
    expect(toGitRemoteRenameReadiness(remote('upStream'), 'UPSTREAM', false).enabled).toBe(false)
  })

  /*
    「使えません」だけだと打ち直せば通ると読まれ、同じところを何度も試す
    ことになる ── なぜ通らないかまで書く。
  */
  it('大文字小文字だけの理由に、なぜ通らないかまで書く', () => {
    const note = toGitRemoteRenameReadiness(remote('origin'), 'Origin', false).note

    expect(note).toContain('大文字と小文字')
    expect(note).toContain('Git')
  })

  /* 前後の空白は落とすが、同じ名前かどうかの判定はその後に行う。 */
  it('前後の空白を落としたうえで、同じ名前かを見る', () => {
    expect(toGitRemoteRenameReadiness(remote('origin'), '  origin  ', false).enabled).toBe(false)
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitRemoteRenameReadiness(remote('origin'), 'upstream', true).enabled).toBe(false)
  })
})
