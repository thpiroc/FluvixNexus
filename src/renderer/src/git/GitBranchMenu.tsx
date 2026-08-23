import type { FormEvent, JSX } from 'react'
import { useCallback, useState } from 'react'
import type { GitHead, GitLocalBranch } from '@shared/git'
import { Popover } from '../ui/Popover'
import {
  describeGitBranchList,
  describeGitBranchTruncation,
  toGitBranchCreateReadiness,
  toGitBranchSwitchReadiness,
  type GitBranchListState
} from './gitBranches'
import { describeGitHead } from './gitRepositoryMessage'

/**
 * ブランチを選ぶ / 作る面（Session 3-8-6）。
 *
 * Git パネルの上のバーで、それまで文字だけだったブランチ名を**押せる場所**に
 * 変えたもの。開く器は `ui/Popover`（閉じ方が3つ＋ウィンドウが焦点を失ったとき）で、
 * ここが持つのは中身の配置だけになる。
 *
 * ## `ui/DropdownMenu` を使わずに Popover から組む
 *
 * 並ぶのが項目だけではないため。この面には**入力欄**（新しいブランチ名）が
 * 入るので、役割は `menu` ではなく `dialog` にあたる ── Terminal の設定 UI が
 * 同じ理由で Popover から組んであるのと同じ形になる。
 *
 * ## 一覧と作成を、1つの面に置く
 *
 * 「切り替える」と「作って切り替える」は、利用者から見て**同じ場面で選ぶこと**に
 * なる（今の作業を別の枝で続けたい、というときに、行き先が既にあるかどうかは
 * 一覧を見て初めて決まる）。別のボタン・別の面に分けると、一覧を開いて
 * 「無かった」と分かってから、閉じて別のところを押し直すことになる。
 *
 * 作成の欄を**下**に置くのは、DESIGN.md 設計判断 2（足すのは下へ）と同じ並びで、
 * 上から「今どこに居るか → どこへ行けるか → 新しく作る」と読めるため。
 *
 * ## 開くたびに取り直す
 *
 * `onOpen` で一覧を取り直す（覚えておいたものを出さない）。`.git` の監視
 * （Session 3-8-8）が配るのは「状態が変わった」という合図までで、
 * ブランチの一覧はそこに相乗りさせていない ── 見られているのは面が開いている
 * 一瞬だけなのに、保存のたびに数え直すことになるため。開くたびに取り直す形に
 * しておけば、届く合図の数に依らず新しいものが出る。
 *
 * ## 文言と押せる条件をここに書かない
 *
 * どちらも gitBranches.ts（React 非依存・テスト対象）が決める。このファイルが
 * 持つのは配置だけ、という分担は GitView.tsx と同じになる。
 */

export function GitBranchMenu({
  head,
  list,
  operating,
  onOpen,
  onSwitch,
  onCreate
}: {
  /** 今 HEAD がどこを指しているか（ボタンの文字になる）。 */
  readonly head: GitHead
  /** 一覧の今の姿（フックが持つ。useGitRepository.ts）。 */
  readonly list: GitBranchListState
  /** 何かしらの Git 操作が動いている最中か。 */
  readonly operating: boolean
  /** 面が開いた（一覧を取り直す契機）。 */
  readonly onOpen: () => void
  readonly onSwitch: (name: string) => void
  /** 作れたかどうかを返す（入力欄を空にしてよいか・面を閉じてよいか）。 */
  readonly onCreate: (name: string) => Promise<boolean>
}): JSX.Element {
  const notice = describeGitBranchList(list)
  const truncation = describeGitBranchTruncation(list)
  /*
    ボタンの文字は、それまでバーに出ていたものとまったく同じ関数から出す
    （gitRepositoryMessage.ts）── 押せる場所になった、というだけの変更で、
    「今どこに居るか」の言い方まで変える理由が無い。
  */
  const label = describeGitHead(head)

  return (
    <Popover
      label={label}
      buttonClassName="fx-git__branch-button"
      buttonLabel={`ブランチ ${label} ── 切り替え / 作成`}
      role="dialog"
      panelLabel="ブランチ"
      panelClassName="fx-git__branch-panel"
      onOpen={onOpen}
    >
      {(close) => (
        <>
          <div className="fx-git__branch-list">
            {notice === null ? (
              list.branches.map((branch) => (
                <GitBranchRow
                  key={branch.name}
                  branch={branch}
                  operating={operating}
                  onSelect={() => {
                    onSwitch(branch.name)
                    close()
                  }}
                />
              ))
            ) : (
              <p className="fx-git__branch-notice" role="status">
                {notice}
              </p>
            )}
          </div>
          {/*
            切れていることの断りは一覧の下に置く。上に置くと、開くたびに
            一番上に現れて、選びたい行の位置が毎回ずれる。
          */}
          {truncation === null ? null : <p className="fx-git__branch-truncated">{truncation}</p>}
          <GitBranchCreateForm operating={operating} onCreate={onCreate} onCreated={close} />
        </>
      )}
    </Popover>
  )
}

/**
 * 一覧の1行。
 *
 * **今のブランチも押せる**（印は付く）── 押しても git は動かず、
 * 「今そこに居ます」として返る（gitBranches.ts）。押せなくすると、
 * 今どこに居るかを確かめるために開いた面で、いちばん見たい行だけが薄くなる。
 *
 * 印の場所は選択の有無に関わらず取っておく（`fx-menu__mark`）── 揃っていないと、
 * 一覧を縦に読むときに名前の開始位置が行ごとに動く。
 */
function GitBranchRow({
  branch,
  operating,
  onSelect
}: {
  readonly branch: GitLocalBranch
  readonly operating: boolean
  readonly onSelect: () => void
}): JSX.Element {
  const readiness = toGitBranchSwitchReadiness(branch, operating)

  return (
    <button
      type="button"
      className="fx-menu__item fx-git__branch-item"
      data-current={branch.current}
      onClick={onSelect}
      disabled={!readiness.enabled}
      title={readiness.note}
      aria-label={readiness.note}
    >
      <span className="fx-menu__mark" aria-hidden="true">
        {branch.current ? '✓' : ''}
      </span>
      <span className="fx-menu__label fx-git__branch-name">{branch.name}</span>
      {branch.current ? <span className="fx-menu__hint">現在</span> : null}
    </button>
  )
}

/**
 * 新しいブランチを作る欄。
 *
 * ## `<form>` にしてある
 *
 * Enter で作れるようにするため。名前を打つ流れの中で、そのまま Enter を
 * 押すのがいちばん短い道になる ── Commit 欄が `Ctrl + Enter` なのは、
 * あちらが複数行の入力欄で Enter が改行だからで、こちらは1行なので
 * 素の Enter を渡してよい。
 *
 * ## 通ったときだけ空にして、閉じる
 *
 * 失敗したときに空にすると、打った名前が失われたうえで「もう一度」と言うことに
 * なる（Commit 欄と同じ判断。GitView.tsx）── 同じ名前が既にあった場合、
 * 直すのは名前の一部だけで済むことが多い。
 *
 * 閉じるのも通ったときだけ。閉じてしまうと、失敗の理由（面の中に出るもの）を
 * 読む前に消えることになる。
 */
function GitBranchCreateForm({
  operating,
  onCreate,
  onCreated
}: {
  readonly operating: boolean
  readonly onCreate: (name: string) => Promise<boolean>
  readonly onCreated: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const readiness = toGitBranchCreateReadiness(name, operating)

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()

      if (!readiness.enabled) {
        return
      }

      void onCreate(name).then((created) => {
        if (created) {
          setName('')
          onCreated()
        }
      })
    },
    [name, onCreate, onCreated, readiness.enabled]
  )

  return (
    <form className="fx-git__branch-create" onSubmit={submit}>
      <div className="fx-git__branch-create-row">
        <input
          type="text"
          className="fx-git__branch-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          // 入力そのものは止めない（止めると、貼り付けた名前を自分で削れなくなる）。
          placeholder="新しいブランチ名"
          aria-label="新しいブランチ名"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="fx-git__branch-create-action"
          disabled={!readiness.enabled}
          title={readiness.note}
        >
          作成
        </button>
      </div>
      {/*
        何が起きるか / なぜ押せないかを、欄の下に1行だけ出す。
        Pull / Push のように hover へ逃がさないのは、ここには文章を置く場所が
        あるためになる（打っている最中の人が、指を止めずに読める）。
      */}
      <p className="fx-git__branch-note" role="status">
        {readiness.note}
      </p>
    </form>
  )
}
