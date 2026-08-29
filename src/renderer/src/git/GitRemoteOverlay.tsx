import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import type { GitOperationFailure, GitOperationOutcome, GitRemote } from '@shared/git'
import { describeGitOperationFailure } from './gitChanges'
import {
  describeGitRemoteList,
  describeGitRemoteRemoveWarning,
  describeGitRemoteSetUrlWarning,
  describeGitRemoteTruncation,
  toGitRemoteAddReadiness,
  toGitRemoteRemoveReadiness,
  toGitRemoteRenameReadiness,
  toGitRemoteSetUrlReadiness,
  GIT_DEFAULT_REMOTE_NAME,
  type GitRemoteListState
} from './gitRemotes'

/**
 * 行の下に開いているもの（Session 3-8-17）。
 *
 * 3-8-16 では削除の確認1つだけだったので名前（`string | null`）で足りたが、
 * 操作が3つになったので**どれを開いているか**まで持つ ──
 * `GitBranchMenu.tsx` が削除と rename で持っている形とまったく同じになる。
 *
 * 一度に開くのは1つだけ ── 同じ行で URL と名前を同時に編めるようにすると、
 * どちらを押したのかが押した後に分からなくなる。
 */
type GitRemoteRowMode = 'set-url' | 'rename' | 'remove'

interface GitRemoteOpenedRow {
  readonly name: string
  readonly mode: GitRemoteRowMode
}

/**
 * remote を見る / 足す / 消す面（Session 3-8-16）と、
 * 行ごとの URL の変更 / 名前の変更（Session 3-8-17）。
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
 * ## URL は今も片道のまま（3-8-17 で欄が2つになっても）
 *
 * 打った URL は Main へ渡り、**戻ってこない** ── 一覧の行に出るのは
 * 名前と表示用のラベルだけになる（shared/git/remote.ts）。したがって
 * 3-8-17 で足した「URL 変更」の欄も**空から始まる** ── 今の URL を
 * 初期値に入れる手立てがそもそも無い。
 *
 * 変える相手が分からなくならないよう、欄の上には**ラベル**を出す
 * （`GitRemoteSetUrlForm`）── これは既に一覧の行に出ているものと同じ値で、
 * 新しく渡ってくるものは1つも無い。「URL を見る」はこの面に今も無い。
 *
 * ## `Esc` は開いた順に1つずつほどく
 *
 *   Esc（行の下が開いている） … そこだけを畳む
 *   Esc（一覧を見ている）     … 面を閉じる
 *
 * URL 変更の確認は**行の下の中で置き換わる**ので、段は増えない
 * （`GitRemoteSetUrlForm`）── 別の面を重ねると `Esc` が3段になる。
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
  onSetUrl,
  onRename,
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
  /** 送り先（URL）を変える（Session 3-8-17）。 */
  readonly onSetUrl: (remote: GitRemote, url: string) => Promise<GitOperationOutcome | null>
  /** 名前を変える（Session 3-8-17）。 */
  readonly onRename: (remote: GitRemote, newName: string) => Promise<GitOperationOutcome | null>
  readonly onRemove: (remote: GitRemote) => Promise<GitOperationOutcome | null>
  readonly onClose: () => void
}): JSX.Element {
  /*
    どの行の下に、何が開いているか。

    フックではなくこの面が持つ ── 書き換えるものが1つも無い**画面の状態**に
    あたり、面を閉じれば一緒に消えてよい（3-8-14 / 3-8-15 と同じ判断）。

    持つのは名前で、これは**指した先がひとりでに変わらない**値になる ──
    退避が `shortHash` を持たざるをえなかったのは番号が動くためで
    （shared/git/stash.ts）、remote にその事情は無い。3-8-17 の rename で
    名前は変わりうるが、変えた直後に一覧を取り直すので、**変わった行は
    「消えた行」として畳まれる**（下の後片付け）── 新しい名前の行を
    開いたままにはしない。押した操作は終わっている。
  */
  const [opened, setOpened] = useState<GitRemoteOpenedRow | null>(null)

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
    setOpened(null)
    setFailure(null)
  }, [])

  const openRow = useCallback((row: GitRemoteOpenedRow): void => {
    setOpened(row)
    // 開き直したら、前に出ていた理由は消す（別のことについての文になる）。
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

      if (opened !== null) {
        closeRow()
        return
      }

      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [opened, closeRow, onClose])

  /*
    一覧が入れ替わったときに、消えた行の下が開いたままにならないようにする
    （3-8-14 / 3-8-15 と同じ後片付け）── 消すと一覧を取り直すので、
    開いていた行そのものが無くなることが普通に起きる。
  */
  useEffect(() => {
    if (opened === null) {
      return
    }

    if (!list.remotes.some((remote) => remote.name === opened.name)) {
      setOpened(null)
    }
  }, [list.remotes, opened])

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
                opened={opened?.name === remote.name ? opened.mode : null}
                failure={failure}
                onSetUrl={onSetUrl}
                onRename={onRename}
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
      {failure === null || opened !== null ? null : (
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
 * 3-8-16 では押せるのが右端の ✕ だけだった。3-8-17 で「URL 変更」と
 * 「名前変更」が加わり、**1行の中に操作が3つ並ぶ** ── ブランチの行
 * （切り替え / rename / 削除）とまったく同じ形になる（GitBranchMenu.tsx）。
 *
 * ## 行そのものは、3つになっても押せないまま
 *
 * remote を「選ぶ」操作が1つも無いのは 3-8-16 から変わらない ── 増えた
 * 2つはどちらも**その remote の中身を書き換える**もので、送り先を選ぶ
 * ものではない（main/git/gitRemotes.ts）。
 *
 * ## 3つとも、押すとその場で git が動くのではなく行の下が開く
 *
 * 名前変更だけは確認ではなく**入力欄**が開く（失われるものが1つも無いため。
 * 3-8-14 のブランチの rename と同じ）── URL 変更は入力欄を出したうえで、
 * 押した後にもう一段の確認を出す（Git で5つめの確認。§14.25）。
 */
function GitRemoteRowView({
  remote,
  operating,
  opened,
  failure,
  onSetUrl,
  onRename,
  onRemove,
  onOpenRow,
  onCloseRow,
  onOutcome
}: {
  readonly remote: GitRemote
  readonly operating: boolean
  /** この行の下に何が開いているか（何も開いていなければ null）。 */
  readonly opened: GitRemoteRowMode | null
  readonly failure: GitOperationFailure | null
  readonly onSetUrl: (remote: GitRemote, url: string) => Promise<GitOperationOutcome | null>
  readonly onRename: (remote: GitRemote, newName: string) => Promise<GitOperationOutcome | null>
  readonly onRemove: (remote: GitRemote) => Promise<GitOperationOutcome | null>
  readonly onOpenRow: (row: GitRemoteOpenedRow) => void
  readonly onCloseRow: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const removeReadiness = toGitRemoteRemoveReadiness(remote, operating)

  return (
    <li className="fx-git__remote-entry" data-opened={opened ?? undefined}>
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
          3つとも押すと**その場で git が動くのではなく行の下が開く。**
          `aria-expanded` を持たせてあるのはそのためで、押した結果として
          何かが現れることを、見えていない人にも同じように伝える（3-8-14 / 3-8-15 と同じ）。

          並びは「変える → 変える → 消す」で、**消すのがいちばん右**になる ──
          ブランチの行と同じ並びで、戻せない側を端に置く。

          止めるのは他の Git 操作が動いている間だけで、3つとも同じ条件に
          なる（押す前に分かる「絶対に通らない理由」は、開いた先の欄が言う ──
          大文字小文字だけの rename はそこで押せなくなる）。
        */}
        <button
          type="button"
          className="fx-git__remote-action"
          data-action="set-url"
          onClick={() => onOpenRow({ name: remote.name, mode: 'set-url' })}
          disabled={operating}
          aria-expanded={opened === 'set-url'}
          title={`${remote.name} の送り先（URL）を変更`}
          aria-label={`${remote.name} の URL を変更`}
        >
          🔗
        </button>
        <button
          type="button"
          className="fx-git__remote-action"
          data-action="rename"
          onClick={() => onOpenRow({ name: remote.name, mode: 'rename' })}
          disabled={operating}
          aria-expanded={opened === 'rename'}
          title={`${remote.name} の名前を変更`}
          aria-label={`${remote.name} の名前を変更`}
        >
          ✎
        </button>
        <button
          type="button"
          className="fx-git__remote-action"
          data-action="remove"
          onClick={() => onOpenRow({ name: remote.name, mode: 'remove' })}
          disabled={!removeReadiness.enabled}
          aria-expanded={opened === 'remove'}
          title={removeReadiness.note}
          aria-label={`${remote.name} を削除`}
        >
          ✕
        </button>
      </div>
      {opened === 'set-url' ? (
        <GitRemoteSetUrlForm
          remote={remote}
          operating={operating}
          failure={failure}
          onSetUrl={onSetUrl}
          onCancel={onCloseRow}
          onOutcome={onOutcome}
        />
      ) : null}
      {opened === 'rename' ? (
        <GitRemoteRenameForm
          remote={remote}
          operating={operating}
          failure={failure}
          onRename={onRename}
          onCancel={onCloseRow}
          onOutcome={onOutcome}
        />
      ) : null}
      {opened === 'remove' ? (
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
 * 行の下に開く「URL 変更」の欄と、その確認（Session 3-8-17）。
 *
 * ## この面で唯一、2段になる操作
 *
 * 打つ → 確認 → 適用の3手になる。他の操作（追加・rename）は打ったら
 * すぐ通り、削除は確認だけで打つものが無い ── ここだけ両方在るのは、
 * **打った値が正しくても、変更そのものを知らせる必要がある**ためになる
 * （3-8-16 が set-url を置かなかった理由は「黙って上書きされること」だった。
 * docs/ARCHITECTURE.md §14.25）。
 *
 * ## 欄は空から始まる
 *
 * 今の URL は Renderer に**届いていない**（一覧に載るのはラベルだけ。
 * shared/git/remote.ts）── したがって初期値に入れる値がそもそも無い。
 * ブランチの rename の欄が今の名前で始まるのとは、そこが違う。
 *
 * 代わりに、今どこを指しているかは**ラベルとして欄の上に出す** ──
 * 打ち始める前に「何を変えようとしているか」は読める。
 *
 * ## 確認は同じ場所に出す
 *
 * 別の面を重ねない（`Esc` のほどき方が1段深くなる）── 欄のあった場所を
 * 確認で置き換え、「やめる」で欄へ戻す。打った URL はその間ずっと
 * 手元に残っているので、**戻って直せる。**
 */
function GitRemoteSetUrlForm({
  remote,
  operating,
  failure,
  onSetUrl,
  onCancel,
  onOutcome
}: {
  readonly remote: GitRemote
  readonly operating: boolean
  readonly failure: GitOperationFailure | null
  readonly onSetUrl: (remote: GitRemote, url: string) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const [url, setUrl] = useState('')
  /** 確認まで進んでいるか（打っている段では false）。 */
  const [confirming, setConfirming] = useState(false)

  const readiness = toGitRemoteSetUrlReadiness(remote, url, operating)
  const warning = describeGitRemoteSetUrlWarning(remote, url)

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()

      if (!readiness.enabled) {
        return
      }

      // 押しても git はまだ動かない ── 次に出るのは確認になる。
      setConfirming(true)
      onOutcome(null)
    },
    [readiness.enabled, onOutcome]
  )

  const confirm = useCallback((): void => {
    void onSetUrl(remote, url).then((outcome) => {
      onOutcome(outcome === null || outcome.status === 'applied' ? null : outcome)

      /*
        失敗したら欄へ戻す ── 打った URL はそのまま残っているので、
        理由を読んでから直せる（追加の欄で通ったときだけ空にするのと
        同じ判断）。通ったときは一覧が入れ替わり、面の側の後片付けが
        この行ごと畳む（`GitRemoteOverlay` の `useEffect`）。
      */
      if (outcome !== null && outcome.status !== 'applied') {
        setConfirming(false)
      }
    })
  }, [onSetUrl, onOutcome, remote, url])

  if (confirming) {
    return (
      <div
        className="fx-git__remote-confirm"
        role="alertdialog"
        aria-label="リモートの送り先を変更する確認"
        data-testid="git-remote-set-url-confirm"
      >
        <p className="fx-git__remote-confirm-message">{warning.message}</p>
        {/*
          今どこを指していて、これからどこを指すか。**左は一覧の行が
          持っているラベル、右は利用者が今その欄に打った文字列**で、
          どちらも新しく境界を渡ってきた値ではない（3-8-16 の
          「URL は Renderer へ渡さない」は動いていない）。
        */}
        <dl className="fx-git__remote-diff">
          <div className="fx-git__remote-diff-row">
            <dt className="fx-git__remote-diff-label">現在</dt>
            <dd className="fx-git__remote-diff-value">{warning.currentLabel}</dd>
          </div>
          <div className="fx-git__remote-diff-row">
            <dt className="fx-git__remote-diff-label">変更後</dt>
            <dd className="fx-git__remote-diff-value" data-testid="git-remote-set-url-next">
              {warning.nextUrl}
            </dd>
          </div>
        </dl>
        <p className="fx-git__remote-confirm-note">{warning.note}</p>
        <div className="fx-git__remote-confirm-actions">
          <button
            type="button"
            className="fx-git__remote-confirm-button"
            onClick={() => setConfirming(false)}
            // 確認を出す目的は誤操作を止めることなので、既定はこちらに置く。
            autoFocus
          >
            やめる
          </button>
          <button
            type="button"
            className="fx-git__remote-confirm-button"
            data-variant="danger"
            data-testid="git-remote-set-url-apply"
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

  return (
    <form className="fx-git__remote-edit" onSubmit={submit} data-testid="git-remote-set-url-form">
      {/*
        今どこを指しているか。欄が空から始まるので、**変える相手は
        文として出しておく**（main/git/gitRemoteLabel.ts が作ったラベル）。
      */}
      <p className="fx-git__remote-edit-current">
        現在の送り先: <span className="fx-git__remote-location">{remote.label}</span>
      </p>
      <input
        type="text"
        className="fx-git__remote-input"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://github.com/owner/repo.git"
        aria-label={`${remote.name} の新しい URL`}
        spellCheck={false}
        autoComplete="off"
        autoFocus
      />
      {/*
        押せない理由は**ボタンの上に1行**として置く（追加の欄がボタンの左に
        置いているのとは違う）── ここの文は「なぜ通らないか」まで書くため
        長くなることがあり、横に並べるとパネルが狭いときにボタンが潰れる。
      */}
      <span className="fx-git__remote-note" role="status">
        {readiness.note}
      </span>
      <div className="fx-git__remote-edit-bar">
        <button type="button" className="fx-git__remote-edit-cancel" onClick={onCancel}>
          やめる
        </button>
        <button
          type="submit"
          className="fx-git__remote-edit-apply"
          disabled={!readiness.enabled}
          title={readiness.note}
          data-testid="git-remote-set-url-next-step"
        >
          確認
        </button>
      </div>
      {failure === null ? null : (
        <p className="fx-git__remote-failure" role="alert">
          {describeGitOperationFailure(failure)}
        </p>
      )}
    </form>
  )
}

/**
 * 行の下に開く「名前変更」の欄（Session 3-8-17）。
 *
 * ## 確認を挟まない
 *
 * `git remote rename` は remote-tracking ref も追っていたブランチの
 * 追跡先も `remote.pushDefault` も全部追随させる ── **失われるものが
 * 1つも無い**（main/git/gitRemotes.ts）。3-8-14 のブランチの rename と
 * まったく同じ形で、打ったら通る。
 *
 * ## 欄は今の名前で始まる
 *
 * ブランチの rename と同じ（`GitBranchRenameForm`）── 一部だけ直したい
 * ことが多く、開いた直後は「同じ名前」として押せない状態になる
 * （`toGitRemoteRenameReadiness` がそう言う）。
 *
 * URL の欄が空から始まるのとの違いは、**比べる相手が手元にあるか**に
 * なる ── 名前は一覧の行が持っているが、URL は持っていない。
 */
function GitRemoteRenameForm({
  remote,
  operating,
  failure,
  onRename,
  onCancel,
  onOutcome
}: {
  readonly remote: GitRemote
  readonly operating: boolean
  readonly failure: GitOperationFailure | null
  readonly onRename: (remote: GitRemote, newName: string) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const [newName, setNewName] = useState(remote.name)

  const readiness = toGitRemoteRenameReadiness(remote, newName, operating)

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()

      if (!readiness.enabled) {
        return
      }

      void onRename(remote, newName).then((outcome) => {
        onOutcome(outcome === null || outcome.status === 'applied' ? null : outcome)
      })
    },
    [readiness.enabled, newName, onOutcome, onRename, remote]
  )

  return (
    <form className="fx-git__remote-edit" onSubmit={submit} data-testid="git-remote-rename-form">
      <input
        type="text"
        className="fx-git__remote-input"
        value={newName}
        onChange={(event) => setNewName(event.target.value)}
        placeholder={remote.name}
        aria-label={`${remote.name} の新しい名前`}
        spellCheck={false}
        autoComplete="off"
        autoFocus
      />
      {/*
        押せない理由は**ボタンの上に1行**として置く（追加の欄がボタンの左に
        置いているのとは違う）── ここの文は「なぜ通らないか」まで書くため
        長くなることがあり、横に並べるとパネルが狭いときにボタンが潰れる。
      */}
      <span className="fx-git__remote-note" role="status">
        {readiness.note}
      </span>
      <div className="fx-git__remote-edit-bar">
        <button type="button" className="fx-git__remote-edit-cancel" onClick={onCancel}>
          やめる
        </button>
        <button
          type="submit"
          className="fx-git__remote-edit-apply"
          disabled={!readiness.enabled}
          title={readiness.note}
          data-testid="git-remote-rename-apply"
        >
          変更
        </button>
      </div>
      {failure === null ? null : (
        <p className="fx-git__remote-failure" role="alert">
          {describeGitOperationFailure(failure)}
        </p>
      )}
    </form>
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
