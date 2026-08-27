import type { FormEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { GitHead, GitLocalBranch, GitOperationFailure, GitOperationOutcome } from '@shared/git'
import { Popover } from '../ui/Popover'
import {
  describeGitBranchDeleteWarning,
  describeGitBranchList,
  describeGitBranchTruncation,
  toGitBranchCreateReadiness,
  toGitBranchDeleteReadiness,
  toGitBranchRenameReadiness,
  toGitBranchSwitchReadiness,
  type GitBranchListState
} from './gitBranches'
import { describeGitOperationFailure } from './gitChanges'
import { describeGitHead } from './gitRepositoryMessage'

/**
 * ブランチを選ぶ / 作る / 消す / 名前を変える面（Session 3-8-6 / 3-8-14）。
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
 * ## Session 3-8-14 で、行が「押すもの」から「操作を持つもの」になった
 *
 * 3-8-6 の行は全幅のボタン1つだった。削除と rename が加わって、1行の中に
 * 押せる場所が3つ並ぶ ── ボタンの中にボタンは置けないので、行は
 * `<div>` の器になり、切り替えがその中の1つ目のボタンになる。
 *
 *   行そのもの … 切り替える（今のブランチも押せる。§14.14）
 *   ✎         … 行の下に名前の入力欄を開く
 *   ✕         … 行の下に削除の確認を開く（今のブランチでは押せない）
 *
 * ## 面を増やさず、行の下に開く（3-8-13 と同じ形）
 *
 * 確認も入力欄も、**押した行のすぐ下**に開く。別の面（`GitDiscardConfirm` の
 * ような重なる器）にしないのは、Popover が外側の pointerdown で閉じるため ──
 * 確認している最中に一覧が消えることになる。行の下なら、対象はそのまま真上に
 * 出ていて、`Esc` でほどく数も1つで済む。
 *
 * **開けるのは一度に1つだけ**（`opened`）。行ごとに開けると、打ちかけの名前が
 * 複数残り、どれを確定しようとしていたのかが押す瞬間まで決まらない
 * （履歴の面の欄と同じ判断。§14.21）。
 *
 * ## `Esc` は開いた順に1つずつほどく
 *
 *   Esc（行の下が開いている） … そこだけを畳む
 *   Esc（一覧を見ている）     … 面を閉じる
 *
 * 器の側に「中で何か開いている間は Esc を待たない」を渡してある
 * （`escapeSuspended`）── 同じ `window` に付いた2つの購読は
 * `stopPropagation` を挟んでもどちらも呼ばれるため、**居ないのと同じ**に
 * するしかない（履歴の面が差分に重なられている間と同じ形）。
 *
 * ## 通っても面を閉じない（削除 / rename）
 *
 * 切り替えと作成は通ったら閉じる（行き先へ移ったので、この面はもう
 * 別のブランチのものになる）。削除と rename は移らない ── 溜まった枝を
 * 続けて片付けられるように開いたままにし、一覧はフックが取り直す
 * （useGitRepository.ts）。
 *
 * ## 文言と押せる条件をここに書かない
 *
 * どちらも gitBranches.ts / gitChanges.ts（React 非依存・テスト対象）が決める。
 * このファイルが持つのは配置だけ、という分担は GitView.tsx と同じになる。
 */

/**
 * 行の下で今開いているもの。
 *
 * 名前と種類の両方を持つのは、**同じ行で ✎ と ✕ を押し替えられる**ようにする
 * ため（片方を開いたまま、もう片方を押したら入れ替わる）。
 */
interface OpenedBranchRow {
  readonly name: string
  readonly mode: 'delete' | 'rename'
}

export function GitBranchMenu({
  head,
  list,
  operating,
  onOpen,
  onSwitch,
  onCreate,
  onDelete,
  onRename
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
  /** 削除する（結末をそのまま返す ── 理由を行の下に出すため）。 */
  readonly onDelete: (name: string) => Promise<GitOperationOutcome | null>
  /** 名前を変える（結末をそのまま返す）。 */
  readonly onRename: (name: string, newName: string) => Promise<GitOperationOutcome | null>
}): JSX.Element {
  const notice = describeGitBranchList(list)
  const truncation = describeGitBranchTruncation(list)
  /*
    ボタンの文字は、それまでバーに出ていたものとまったく同じ関数から出す
    （gitRepositoryMessage.ts）── 押せる場所になった、というだけの変更で、
    「今どこに居るか」の言い方まで変える理由が無い。
  */
  const label = describeGitHead(head)

  /*
    行の下に開いているものは、**この面の側が持つ**（フックではない）── 3-8-13 で
    履歴の欄をそうしたのと同じ判断で、書き換えるものが1つも無い画面の状態にあたる。

    `Popover` の中ではなくここに置いてあるのは、器へ `escapeSuspended` を
    渡す必要があるため ── 器は「中で何かが開いているか」を自分では知りえない。
  */
  const [opened, setOpened] = useState<OpenedBranchRow | null>(null)
  /*
    行の下から押した1回の結末だけを持つ。次に押したら必ず上書きする
    （`null` を含む）── 残しておくと、2回目に通ったときに1回目の理由が居座る。

    パネル全体の `failure` を渡さないのは 3-8-13 と同じ理由になる ──
    面を開く前に失敗していた Push の理由が、ブランチを消そうとしただけの人の
    目の前に出ることになる。
  */
  const [failure, setFailure] = useState<GitOperationFailure | null>(null)

  const closeRow = useCallback((): void => {
    setOpened(null)
    setFailure(null)
  }, [])

  const openRow = useCallback((row: OpenedBranchRow): void => {
    setOpened(row)
    // 行を開き直したら、前の行で出ていた理由は消す（別のことについての文になる）。
    setFailure(null)
  }, [])

  /*
    Esc は行の下を先に畳む（器の側は `escapeSuspended` で下りている）。

    購読を張るのは開いている間だけ ── 閉じている間も張ると、面そのものを
    閉じる Esc と二重になる。
  */
  useEffect(() => {
    if (opened === null) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      closeRow()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [opened, closeRow])

  /*
    一覧が入れ替わったときに、消えた行の下が開いたままにならないようにする。

    削除が通ると一覧を取り直す（useGitRepository.ts）ので、**開いていた行
    そのものが無くなる**ことが普通に起きる。畳まないと、どの行にも属さない
    確認だけが宙に浮いて残ることになる。

    rename が通った場合も同じ ── 開いていたのは古い名前の行になる。
  */
  useEffect(() => {
    if (opened === null) {
      return
    }

    if (!list.branches.some((branch) => branch.name === opened.name)) {
      setOpened(null)
    }
  }, [list.branches, opened])

  return (
    <Popover
      label={label}
      buttonClassName="fx-git__branch-button"
      buttonLabel={`ブランチ ${label} ── 切り替え / 作成`}
      role="dialog"
      panelLabel="ブランチ"
      panelClassName="fx-git__branch-panel"
      /*
        開くたびに、行の下は畳んだ状態から始める ── 外側を押して閉じた面を
        開き直したときに、前回打ちかけていた名前がそのまま出ていると、
        今どの行について何をしようとしているのかが分からなくなる。
      */
      onOpen={() => {
        closeRow()
        onOpen()
      }}
      escapeSuspended={opened !== null}
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
                  opened={opened !== null && opened.name === branch.name ? opened.mode : null}
                  failure={failure}
                  onSelect={() => {
                    onSwitch(branch.name)
                    close()
                  }}
                  onOpenRow={openRow}
                  onCloseRow={closeRow}
                  onDelete={onDelete}
                  onRename={onRename}
                  onOutcome={setFailure}
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
 * 一覧の1行と、その下に開くもの。
 *
 * **今のブランチも押せる**（印は付く）── 押しても git は動かず、
 * 「今そこに居ます」として返る（gitBranches.ts）。押せなくすると、
 * 今どこに居るかを確かめるために開いた面で、いちばん見たい行だけが薄くなる。
 *
 * 一方 ✕（削除）は**今のブランチでだけ押せない。** 違いは「押しても何も
 * 起きない」か「押しても絶対に通らない」かで、後者は待っても押せるように
 * ならない ── 押せない状態にして理由を添える（消さないのは、行ごとに
 * ボタンの数が変わると一覧の見た目が揃わなくなるため）。
 *
 * 印の場所は選択の有無に関わらず取っておく（`fx-menu__mark`）── 揃っていないと、
 * 一覧を縦に読むときに名前の開始位置が行ごとに動く。
 */
function GitBranchRow({
  branch,
  operating,
  opened,
  failure,
  onSelect,
  onOpenRow,
  onCloseRow,
  onDelete,
  onRename,
  onOutcome
}: {
  readonly branch: GitLocalBranch
  readonly operating: boolean
  /** この行の下で開いているもの（無ければ null）。 */
  readonly opened: OpenedBranchRow['mode'] | null
  readonly failure: GitOperationFailure | null
  readonly onSelect: () => void
  readonly onOpenRow: (row: OpenedBranchRow) => void
  readonly onCloseRow: () => void
  readonly onDelete: (name: string) => Promise<GitOperationOutcome | null>
  readonly onRename: (name: string, newName: string) => Promise<GitOperationOutcome | null>
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const switchReadiness = toGitBranchSwitchReadiness(branch, operating)
  const deleteReadiness = toGitBranchDeleteReadiness(branch, operating)

  return (
    <div className="fx-git__branch-entry" data-current={branch.current}>
      <div className="fx-git__branch-item" data-current={branch.current}>
        <button
          type="button"
          className="fx-menu__item fx-git__branch-switch"
          onClick={onSelect}
          disabled={!switchReadiness.enabled}
          title={switchReadiness.note}
          aria-label={switchReadiness.note}
        >
          <span className="fx-menu__mark" aria-hidden="true">
            {branch.current ? '✓' : ''}
          </span>
          <span className="fx-menu__label fx-git__branch-name">{branch.name}</span>
          {branch.current ? <span className="fx-menu__hint">現在</span> : null}
        </button>
        {/*
          ✎ と ✕ は、押すと**その場で git が動くのではなく行の下が開く。**
          `aria-expanded` を持たせてあるのはそのためで、押した結果として
          何かが現れることを、見えていない人にも同じように伝える。
        */}
        <button
          type="button"
          className="fx-git__branch-action"
          data-action="rename"
          onClick={() => onOpenRow({ name: branch.name, mode: 'rename' })}
          aria-expanded={opened === 'rename'}
          title={`${branch.name} の名前を変更します。`}
          aria-label={`${branch.name} の名前を変更`}
        >
          ✎
        </button>
        <button
          type="button"
          className="fx-git__branch-action"
          data-action="delete"
          onClick={() => onOpenRow({ name: branch.name, mode: 'delete' })}
          disabled={!deleteReadiness.enabled}
          aria-expanded={opened === 'delete'}
          title={deleteReadiness.note}
          aria-label={`${branch.name} を削除`}
        >
          ✕
        </button>
      </div>

      {opened === 'delete' ? (
        <GitBranchDeleteConfirm
          branch={branch}
          operating={operating}
          failure={failure}
          onConfirm={onDelete}
          onCancel={onCloseRow}
          onOutcome={onOutcome}
        />
      ) : null}

      {opened === 'rename' ? (
        <GitBranchRenameForm
          branch={branch}
          operating={operating}
          failure={failure}
          onRename={onRename}
          onCancel={onCloseRow}
          onOutcome={onOutcome}
        />
      ) : null}
    </div>
  )
}

/**
 * 行の下に開く削除の確認（Session 3-8-14）。
 *
 * ## Git で確認を挟む、2つめ
 *
 * 1つめは破棄（§14.16）で、あちらは利用者が書いたものを消す唯一の操作だった。
 * こちらが消すのは**枝の名前とその reflog**になる ── `-d` が通るのは
 * 「HEAD か追跡先にマージ済み」のときだけなので、成功した削除で commit が
 * 到達不能になることは無い。
 *
 * それでも確認を挟むのは、押す場所が一覧の行の上（切り替えるつもりで当たる
 * 距離）にあり、消えた名前を戻すには hash を探すことになるため。
 *
 * ## 既定の focus は「やめる」
 *
 * `GitDiscardConfirm` / `DeleteConfirm` と同じで、Enter を押した勢いで
 * そのまま消えない側を既定にする。**器は違っても、尋ね方は揃える。**
 *
 * ## 通ったときのことは、ここに書かれていない
 *
 * 消えると一覧から行そのものが消え、この確認は面の側の後片付けで畳まれる
 * （`GitBranchPanel`）── 自分で閉じる手順を持たない。
 */
function GitBranchDeleteConfirm({
  branch,
  operating,
  failure,
  onConfirm,
  onCancel,
  onOutcome
}: {
  readonly branch: GitLocalBranch
  readonly operating: boolean
  readonly failure: GitOperationFailure | null
  readonly onConfirm: (name: string) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const warning = describeGitBranchDeleteWarning(branch)

  const confirm = useCallback((): void => {
    void onConfirm(branch.name).then((outcome) => {
      onOutcome(outcome === null || outcome.status === 'applied' ? null : outcome)
    })
  }, [branch.name, onConfirm, onOutcome])

  return (
    <div
      className="fx-git__branch-confirm"
      role="alertdialog"
      aria-label={`${branch.name} の削除の確認`}
      data-testid="git-branch-delete-confirm"
      data-branch={branch.name}
    >
      <p className="fx-git__branch-confirm-message">{warning.message}</p>
      <p className="fx-git__branch-confirm-note">{warning.note}</p>
      <div className="fx-git__branch-confirm-actions">
        <button
          type="button"
          className="fx-git__branch-confirm-button"
          onClick={onCancel}
          // 確認を出す目的は誤操作を止めることなので、既定はこちらに置く。
          autoFocus
        >
          やめる
        </button>
        <button
          type="button"
          className="fx-git__branch-confirm-button"
          data-variant="danger"
          data-testid="git-branch-delete-apply"
          disabled={operating}
          onClick={confirm}
        >
          {warning.confirmLabel}
        </button>
      </div>
      {failure === null ? null : (
        <p className="fx-git__branch-failure" role="alert">
          {describeGitOperationFailure(failure)}
        </p>
      )}
    </div>
  )
}

/**
 * 行の下に開く名前の入力欄（Session 3-8-14）。
 *
 * ## 確認を挟まない
 *
 * rename で失われるものは1つも無い（ref の名前が変わるだけで、commit も
 * 作業ツリーも index も動かない）── 確認を出すこと自体が目的ではない（§12.6）。
 *
 * ## 初期値は今の名前
 *
 * 改名は「一部を直す」ことが多い（`feture-x` → `feature-x`）ため、空欄から
 * 打ち直させない。開いた瞬間に全選択してあるので、まるごと差し替えたい人は
 * そのまま打てばよい。
 *
 * その代わり、開いた直後は必ず「同じ名前」の状態になる ── そのとき
 * 押せない理由が「間違い」ではなく「新しい名前を入力してください」なのは
 * そのため（gitBranches.ts）。
 *
 * ## 失敗しても名前を消さない
 *
 * Commit 欄・ブランチの作成欄と同じ判断（GitBranchMenu の作成欄）──
 * 「同じ名前が既にあります」と言われた人が、また一から打ち直すことになる。
 */
function GitBranchRenameForm({
  branch,
  operating,
  failure,
  onRename,
  onCancel,
  onOutcome
}: {
  readonly branch: GitLocalBranch
  readonly operating: boolean
  readonly failure: GitOperationFailure | null
  readonly onRename: (name: string, newName: string) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const [newName, setNewName] = useState(branch.name)
  const readiness = toGitBranchRenameReadiness(branch, newName, operating)

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()

      if (!readiness.enabled) {
        return
      }

      void onRename(branch.name, newName).then((outcome) => {
        onOutcome(outcome === null || outcome.status === 'applied' ? null : outcome)
      })
    },
    [branch.name, newName, onOutcome, onRename, readiness.enabled]
  )

  return (
    <form
      className="fx-git__branch-rename"
      onSubmit={submit}
      data-testid="git-branch-rename-form"
      data-branch={branch.name}
    >
      <div className="fx-git__branch-rename-row">
        <input
          type="text"
          className="fx-git__branch-input"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          // 入力そのものは止めない（止めると、貼り付けた名前を自分で削れなくなる）。
          aria-label={`${branch.name} の新しい名前`}
          spellCheck={false}
          autoComplete="off"
          /*
            押した直後に打ち始められるようにし、全選択しておく ── まるごと
            差し替えたい人はそのまま打て、一部を直したい人は矢印キーで解ける。
          */
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="submit"
          className="fx-git__branch-create-action"
          disabled={!readiness.enabled}
          title={readiness.note}
        >
          変更
        </button>
        {/*
          やめる道を、`Esc` の他にも置く（履歴の面の欄と同じ）── 打鍵を
          知らない人が畳めなくなる。`type="button"` を明示してあるのは、
          `<form>` の中の既定が `submit` のためになる。
        */}
        <button
          type="button"
          className="fx-git__branch-rename-cancel"
          onClick={onCancel}
          title="やめる（Esc）"
          aria-label="やめる"
        >
          ×
        </button>
      </div>
      <p className="fx-git__branch-note" role="status">
        {readiness.note}
      </p>
      {failure === null ? null : (
        <p className="fx-git__branch-failure" role="alert">
          {describeGitOperationFailure(failure)}
        </p>
      )}
    </form>
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
