import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import type { GitOperationFailure, GitOperationOutcome, GitRemote } from '@shared/git'
import { describeGitOperationFailure } from './gitChanges'
import {
  describeGitRemoteList,
  describeGitRemoteRemoveWarning,
  describeGitRemoteTruncation,
  toGitRemoteAddReadiness,
  toGitRemoteRemoveReadiness,
  GIT_DEFAULT_REMOTE_NAME,
  type GitRemoteListState
} from './gitRemotes'

/**
 * remote を見る / 足す / 消す面（Session 3-8-16）。
 *
 * ## 退避の面と同じ器にしてある
 *
 * 重ねる・Esc と `×` で閉じる・面の中にだけ理由を出す・行の下に確認を開く ──
 * どれも 3-8-9 で差分に対して決め、3-8-11 / 3-8-15 が引き継いだもので、
 * remote でも変える理由が無い。**同じ場所に出て同じ閉じ方をする**方が、
 * 覚えることが増えない。
 *
 * ## 一覧と追加の欄を、1つの面に置く
 *
 * ブランチの面・退避の面と同じ判断になる ── 「消す」と「足す」は
 * 利用者から見て**同じ場面で選ぶこと**で、今何が登録されているかを見てから
 * 決まる。とくにここでは、1つも無い状態で開く人（`hasRemote` が false の
 * リポジトリ）がいちばん多い ── その人にとってこの面は
 * 「一覧」ではなく「接続する場所」になる。
 *
 * 追加の欄を**下**に置くのは、DESIGN.md 設計判断 2（足すのは下へ）と
 * 同じ並びで、上から「今何が登録されているか → 新しく足す」と読めるため。
 *
 * ## 入力欄が2つ並ぶ、初めての面
 *
 * ブランチの作成も GitHub の公開も、打つ欄は1つだった（公開の面の
 * ラジオは選ぶもので、打つものではない）。ここは名前と URL の2つになる ──
 * **上から順に直せる**ように、押せない理由も名前 → URL の順で出す
 * （gitRemotes.ts の `toGitRemoteAddReadiness`）。
 *
 * ## URL は面の中にしか無い
 *
 * 打った URL は追加のときに1度 Main へ渡り、**戻ってこない** ──
 * 一覧の行に出るのは名前と表示用のラベルだけになる（shared/git/remote.ts）。
 * したがってこの面には「URL を見る」も「URL を直す」も無い
 * （変更は 3-8-16 の範囲外。docs/ARCHITECTURE.md §14.24）。
 *
 * ## `Esc` は開いた順に1つずつほどく
 *
 *   Esc（行の下が開いている） … そこだけを畳む
 *   Esc（一覧を見ている）     … 面を閉じる
 *
 * ## 文言と押せる条件をここに書かない
 *
 * どちらも gitRemotes.ts / gitChanges.ts（React 非依存・テスト対象）が決める。
 * このファイルが持つのは配置だけ、という分担は GitStashOverlay.tsx と同じになる。
 */
export function GitRemoteOverlay({
  list,
  operating,
  adding,
  onAdd,
  onRemove,
  onClose
}: {
  readonly list: GitRemoteListState
  /** 何かしらの Git 操作が動いている最中か。 */
  readonly operating: boolean
  /** 追加そのものが動いている最中か（ボタンの文字を変える）。 */
  readonly adding: boolean
  /** remote を1つ足す（結末をそのまま返す ── 理由を面の中に出すため）。 */
  readonly onAdd: (name: string, url: string) => Promise<GitOperationOutcome | null>
  readonly onRemove: (remote: GitRemote) => Promise<GitOperationOutcome | null>
  readonly onClose: () => void
}): JSX.Element {
  /*
    どの行の下に、削除の確認が開いているか。

    フックではなくこの面が持つ ── 書き換えるものが1つも無い**画面の状態**に
    あたり、面を閉じれば一緒に消えてよい（3-8-14 / 3-8-15 と同じ判断）。

    持つのは名前で、これは**指した先がひとりでに変わらない**値になる ──
    退避が `shortHash` を持たざるをえなかったのは番号が動くためで
    （shared/git/stash.ts）、remote にその事情は無い。
  */
  const [removing, setRemoving] = useState<string | null>(null)

  /*
    面の中で押した1回の結末だけを持つ。次に押したら必ず上書きする（`null` を
    含む）── パネル全体の `failure` を渡さないのは 3-8-13 〜 3-8-15 と
    同じ理由で、面がパネルを覆っているため、面を開く前に失敗していた Push の
    理由が、リモートを見に来ただけの人の目の前に出ることになる。
  */
  const [failure, setFailure] = useState<GitOperationFailure | null>(null)

  const [name, setName] = useState(GIT_DEFAULT_REMOTE_NAME)
  const [url, setUrl] = useState('')

  const closeRow = useCallback((): void => {
    setRemoving(null)
    setFailure(null)
  }, [])

  const openRow = useCallback((remoteName: string): void => {
    setRemoving(remoteName)
    // 行を開き直したら、前の行で出ていた理由は消す（別のことについての文になる）。
    setFailure(null)
  }, [])

  /*
    Esc は行の下を先に畳む（開いた順を1つずつほどく）。

    購読先を `window` にしてあるのは、面の中に focus が無くても効かせるため
    （差分・履歴・退避の面とまったく同じ形）。この面の上に何かが重なることは
    無いので、`suspended` は持たない。
  */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()

      if (removing !== null) {
        closeRow()
        return
      }

      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [removing, closeRow, onClose])

  /*
    一覧が入れ替わったときに、消えた行の下が開いたままにならないようにする
    （3-8-14 / 3-8-15 と同じ後片付け）── 消すと一覧を取り直すので、
    開いていた行そのものが無くなることが普通に起きる。
  */
  useEffect(() => {
    if (removing === null) {
      return
    }

    if (!list.remotes.some((remote) => remote.name === removing)) {
      setRemoving(null)
    }
  }, [list.remotes, removing])

  const notice = describeGitRemoteList(list)
  const truncation = describeGitRemoteTruncation(list)
  const addReadiness = toGitRemoteAddReadiness(name, url, operating)

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()

      if (!addReadiness.enabled) {
        return
      }

      void onAdd(name, url).then((outcome) => {
        setFailure(outcome === null || outcome.status === 'applied' ? null : outcome)

        /*
          通ったときだけ空にする（ブランチの作成・GitHub の公開と同じ判断）──
          失敗のときに消すと、打った URL が理由を読む前に失われる。
          名前は既定へ戻す ── 2つめを足す人にとって `origin` はもう
          使われている名前だが、そこは押した結果（`remote-exists`）が言う。
        */
        if (outcome !== null && outcome.status === 'applied') {
          setName(GIT_DEFAULT_REMOTE_NAME)
          setUrl('')
        }
      })
    },
    [addReadiness.enabled, name, onAdd, url]
  )

  return (
    <div
      className="fx-git__remote-overlay"
      data-testid="git-remote"
      role="dialog"
      aria-modal="false"
      aria-label="リモート"
    >
      <div className="fx-git__remote-bar">
        <span className="fx-git__remote-title">リモート</span>
        {/* 件数は見出しの一部（履歴・退避・変更の一覧と同じ形）。 */}
        {list.status === 'ready' && list.remotes.length > 0 ? (
          <span className="fx-git__remote-count">{list.remotes.length}</span>
        ) : null}
        <button
          type="button"
          className="fx-git__remote-close"
          onClick={onClose}
          title="リモートを閉じる"
          aria-label="リモートを閉じる"
        >
          ×
        </button>
      </div>
      <div className="fx-git__remote-body">
        {notice === null ? (
          <ul className="fx-git__remotes">
            {list.remotes.map((remote) => (
              <GitRemoteRowView
                key={remote.name}
                remote={remote}
                operating={operating}
                removing={removing === remote.name}
                failure={failure}
                onRemove={onRemove}
                onOpenRow={openRow}
                onCloseRow={closeRow}
                onOutcome={setFailure}
              />
            ))}
          </ul>
        ) : (
          <p className="fx-git__remote-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      {/*
        切れていることの断りは一覧の**下**に置く（ブランチ・履歴・退避と同じ）──
        上に置くと、開くたびに一番上に現れて、読みたい行の位置が毎回ずれる。
      */}
      {truncation === null ? null : <p className="fx-git__remote-truncated">{truncation}</p>}
      <form className="fx-git__remote-add" onSubmit={submit}>
        <label className="fx-git__remote-field">
          <span className="fx-git__remote-label">名前</span>
          <input
            type="text"
            className="fx-git__remote-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            // 入力そのものは止めない（止めると、貼り付けた値を自分で削れなくなる）。
            placeholder="origin"
            aria-label="リモート名"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="fx-git__remote-field">
          <span className="fx-git__remote-label">URL</span>
          <input
            type="text"
            className="fx-git__remote-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/owner/repo.git"
            aria-label="リモートの URL"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="fx-git__remote-add-bar">
          {/*
            何が起きるか / なぜ押せないかを、ボタンの左に1行だけ出す
            （ブランチの作成欄・公開の面と同じ形）── 打っている最中の人が、
            指を止めずに読める場所にあたる。
          */}
          <span className="fx-git__remote-note" role="status">
            {addReadiness.note}
          </span>
          <button
            type="submit"
            className="fx-git__remote-add-button"
            disabled={!addReadiness.enabled || adding}
            title={addReadiness.note}
            data-testid="git-remote-add"
          >
            {adding ? '追加しています…' : '追加'}
          </button>
        </div>
      </form>
      {/*
        行の下に出せない結末（追加そのものの失敗）は、ここに出す。
        行の下に出るものと同じ文言の関数を通る（gitChanges.ts）。
      */}
      {failure === null || removing !== null ? null : (
        <p className="fx-git__remote-failure" role="alert">
          {describeGitOperationFailure(failure)}
        </p>
      )}
    </div>
  )
}

/**
 * remote 1件の行と、その下に開くもの。
 *
 * ## 行そのものは押せない
 *
 * 退避の行と同じで、押す先が無い ── remote を「選ぶ」操作が1つも無いため
 * （送り先を決めるのはリポジトリの設定で、名前で指せる欄は作っていない。
 * main/git/gitRemotes.ts）。**押せる形のものを置かない**ので、押せない理由を
 * 言う必要もない。
 *
 * 押せるのは右端の ✕ だけになる。退避の行に「戻す」が在ったような
 * 主たる操作がここに無いのは、**一覧を見に来る理由が「確かめる」だから**に
 * あたる ── 足すのは下の欄、消すのは ✕ で、行の上ですることは無い。
 */
function GitRemoteRowView({
  remote,
  operating,
  removing,
  failure,
  onRemove,
  onOpenRow,
  onCloseRow,
  onOutcome
}: {
  readonly remote: GitRemote
  readonly operating: boolean
  /** この行の下に、削除の確認が開いているか。 */
  readonly removing: boolean
  readonly failure: GitOperationFailure | null
  readonly onRemove: (remote: GitRemote) => Promise<GitOperationOutcome | null>
  readonly onOpenRow: (name: string) => void
  readonly onCloseRow: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const readiness = toGitRemoteRemoveReadiness(remote, operating)

  return (
    <li className="fx-git__remote-entry" data-removing={removing}>
      <div className="fx-git__remote-row">
        <div className="fx-git__remote-main">
          <span className="fx-git__remote-name">{remote.name}</span>
          {/*
            どこを指しているか。**URL ではない**（scheme も認証情報も port も
            落ちている。main/git/gitRemoteLabel.ts）ので、`title` に置く値も
            同じラベルになる ── hover したら URL が出る、という形にしない。
          */}
          <span className="fx-git__remote-location" title={remote.label}>
            {remote.label}
          </span>
        </div>
        {/*
          ✕ は押すと**その場で git が動くのではなく行の下が開く。**
          `aria-expanded` を持たせてあるのはそのためで、押した結果として
          何かが現れることを、見えていない人にも同じように伝える（3-8-14 / 3-8-15 と同じ）。
        */}
        <button
          type="button"
          className="fx-git__remote-action"
          onClick={() => onOpenRow(remote.name)}
          disabled={!readiness.enabled}
          aria-expanded={removing}
          title={readiness.note}
          aria-label={`${remote.name} を削除`}
        >
          ✕
        </button>
      </div>
      {removing ? (
        <GitRemoteRemoveConfirm
          remote={remote}
          operating={operating}
          failure={failure}
          onConfirm={onRemove}
          onCancel={onCloseRow}
          onOutcome={onOutcome}
        />
      ) : null}
    </li>
  )
}

/**
 * 行の下に開く「削除」の確認（Session 3-8-16）。
 *
 * ## 既定の focus は「やめる」
 *
 * `GitDiscardConfirm` / `GitBranchDeleteConfirm` / `GitStashDropConfirm` /
 * `DeleteConfirm` と同じで、Enter を押した勢いでそのまま消えない側を既定に
 * する。**器は違っても、尋ね方は揃える。**
 *
 * ## 通ったときのことは、ここに書かれていない
 *
 * 消すと一覧から行そのものが消え、この確認は面の側の後片付けで畳まれる
 * （`GitRemoteOverlay` の `useEffect`）── 自分で閉じる手順を持たない
 * （3-8-14 / 3-8-15 とまったく同じ形）。
 */
function GitRemoteRemoveConfirm({
  remote,
  operating,
  failure,
  onConfirm,
  onCancel,
  onOutcome
}: {
  readonly remote: GitRemote
  readonly operating: boolean
  readonly failure: GitOperationFailure | null
  readonly onConfirm: (remote: GitRemote) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const warning = describeGitRemoteRemoveWarning(remote)

  const confirm = useCallback((): void => {
    void onConfirm(remote).then((outcome) => {
      onOutcome(outcome === null || outcome.status === 'applied' ? null : outcome)
    })
  }, [remote, onConfirm, onOutcome])

  return (
    <div
      className="fx-git__remote-confirm"
      role="alertdialog"
      aria-label="リモートを削除する確認"
      data-testid="git-remote-remove-confirm"
    >
      <p className="fx-git__remote-confirm-message">{warning.message}</p>
      <p className="fx-git__remote-confirm-note">{warning.note}</p>
      <div className="fx-git__remote-confirm-actions">
        <button
          type="button"
          className="fx-git__remote-confirm-button"
          onClick={onCancel}
          // 確認を出す目的は誤操作を止めることなので、既定はこちらに置く。
          autoFocus
        >
          やめる
        </button>
        <button
          type="button"
          className="fx-git__remote-confirm-button"
          data-variant="danger"
          data-testid="git-remote-remove-apply"
          disabled={operating}
          onClick={confirm}
        >
          {warning.confirmLabel}
        </button>
      </div>
      {failure === null ? null : (
        <p className="fx-git__remote-failure" role="alert">
          {describeGitOperationFailure(failure)}
        </p>
      )}
    </div>
  )
}
