import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { GitOperationFailure, GitOperationOutcome, GitStashEntry } from '@shared/git'
import { describeGitOperationFailure, type GitActionReadiness } from './gitChanges'
import {
  describeGitStashDropWarning,
  describeGitStashList,
  describeGitStashRow,
  describeGitStashTruncation,
  toGitStashDropReadiness,
  toGitStashPopReadiness,
  type GitStashListState
} from './gitStash'

/**
 * 退避（stash）を見る / 戻す / 捨てる / 新しく避ける面（Session 3-8-15）。
 *
 * ## 履歴の面と同じ器にしてある
 *
 * 重ねる・Esc と `×` で閉じる・面の中にだけ理由を出す ── どれも 3-8-9 で
 * 差分に対して決め、3-8-11 で履歴が引き継いだもので、退避でも変える理由が
 * 無い。**同じ場所に出て同じ閉じ方をする**方が、覚えることが増えない。
 *
 * ## 一覧と「退避する」を、1つの面に置く
 *
 * ブランチの面（GitBranchMenu.tsx）が一覧と作成を1つにしたのと同じ判断になる ──
 * 「戻す」と「避ける」は利用者から見て**同じ場面で選ぶこと**で、今いくつ
 * 避けてあるかを見てから決まる。別の場所に分けると、一覧を開いて
 * 「無かった」と分かってから、閉じて別のところを押し直すことになる。
 *
 * 「退避する」を**下**に置くのは、DESIGN.md 設計判断 2（足すのは下へ）と
 * 同じ並びで、上から「今何が避けてあるか → 新しく避ける」と読めるため
 * （ブランチの面の作成欄とまったく同じ位置になる）。
 *
 * ## Popover にしない
 *
 * ブランチの面は `ui/Popover` から組んであるが、こちらは面にした。理由は2つ。
 *
 *   - **行の下に確認が開く。** Popover は外側の pointerdown で閉じるため、
 *     確認している最中に一覧が消えることになる（§14.22 で行の下に開く形を
 *     選んだのと同じ問題で、あちらは器を変えずに済んだが、こちらは1行が
 *     2段（名乗りと日時）あり、100 件並ぶと Popover に収まらない）
 *   - **バーを覆う。** 面が出ている間は上のバーごと隠れるので、履歴と
 *     退避が同時に開くことが起こりえない（`suspended` の仕組みが要らない）
 *
 * ## 面の中に3枚目を重ねない
 *
 * 捨てる確認は**押した行のすぐ下**に開く（3-8-13 の「履歴の行から作る欄」・
 * 3-8-14 の「削除の確認」と同じ形）── 対象がそのまま真上に出ていて、
 * `Esc` でほどく数も1つで済む。
 *
 * ## `Esc` は開いた順に1つずつほどく
 *
 *   Esc（行の下が開いている） … そこだけを畳む
 *   Esc（一覧を見ている）     … 面を閉じる
 *
 * ## 文言と押せる条件をここに書かない
 *
 * どちらも gitStash.ts / gitChanges.ts（React 非依存・テスト対象）が決める。
 * このファイルが持つのは配置だけ、という分担は GitView.tsx / GitBranchMenu.tsx /
 * GitHistoryOverlay.tsx と同じになる。
 */
export function GitStashOverlay({
  list,
  operating,
  pushing,
  pushReadiness,
  onPush,
  onPop,
  onDrop,
  onClose
}: {
  readonly list: GitStashListState
  /** 何かしらの Git 操作が動いている最中か。 */
  readonly operating: boolean
  /** 退避そのものが動いている最中か（ボタンの文字を変える）。 */
  readonly pushing: boolean
  /** 今「退避する」を押せるか、押せないならなぜか（gitStash.ts）。 */
  readonly pushReadiness: GitActionReadiness
  /** 作業ツリーを退避する（結末をそのまま返す ── 理由を面の中に出すため）。 */
  readonly onPush: () => Promise<GitOperationOutcome | null>
  readonly onPop: (entry: GitStashEntry) => Promise<GitOperationOutcome | null>
  readonly onDrop: (entry: GitStashEntry) => Promise<GitOperationOutcome | null>
  readonly onClose: () => void
}): JSX.Element {
  /*
    どの行の下に、捨てる確認が開いているか。

    ## フックではなくこの面が持つ

    書き換えるものが1つも無い**画面の状態**にあたる ── 面を閉じれば一緒に
    消えてよく、フックに置くと閉じるたびに畳む手順が1つ増える（3-8-13 /
    3-8-14 と同じ判断）。

    持つのは `shortHash` で、番号ではない ── 番号は一覧を取り直すたびに
    別の退避を指しうる（shared/git/stash.ts）。開いたままの確認が
    「さっきとは違う行」に移る形にしない。
  */
  const [dropping, setDropping] = useState<string | null>(null)

  /*
    面の中で押した1回の結末だけを持つ。次に押したら必ず上書きする
    （`null` を含む）── 残しておくと、2回目に通ったときに1回目の理由が居座る。

    パネル全体の `failure` を渡さないのは 3-8-13 / 3-8-14 と同じ理由になる ──
    面がパネルを覆っているため、面を開く前に失敗していた Push の理由が、
    退避を見に来ただけの人の目の前に出ることになる。
  */
  const [failure, setFailure] = useState<GitOperationFailure | null>(null)

  const closeRow = useCallback((): void => {
    setDropping(null)
    setFailure(null)
  }, [])

  const openRow = useCallback((shortHash: string): void => {
    setDropping(shortHash)
    // 行を開き直したら、前の行で出ていた理由は消す（別のことについての文になる）。
    setFailure(null)
  }, [])

  /*
    Esc は行の下を先に畳む（開いた順を1つずつほどく）。

    購読先を `window` にしてあるのは、面の中に focus が無くても効かせるため
    （差分・履歴の面とまったく同じ形）。この面の上に何かが重なることは
    無いので、`suspended` は持たない。
  */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()

      if (dropping !== null) {
        closeRow()
        return
      }

      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dropping, closeRow, onClose])

  /*
    一覧が入れ替わったときに、消えた行の下が開いたままにならないようにする
    （3-8-14 のブランチの面と同じ後片付け）── 捨てるか戻すかが通ると
    一覧を取り直すので、**開いていた行そのものが無くなる**ことが普通に起きる。
  */
  useEffect(() => {
    if (dropping === null) {
      return
    }

    if (!list.entries.some((entry) => entry.shortHash === dropping)) {
      setDropping(null)
    }
  }, [list.entries, dropping])

  const notice = describeGitStashList(list)
  const truncation = describeGitStashTruncation(list)

  /*
    「今」は、届いた一覧ごとに1つだけ決める（履歴の面と同じ）── 行を描くたびに
    `Date.now()` を読むと、同じ画面の中で行ごとに違う「今」を見ることになる。
  */
  const now = useMemo(() => Date.now(), [list])

  const runPush = useCallback((): void => {
    void onPush().then((outcome) => {
      setFailure(outcome === null || outcome.status === 'applied' ? null : outcome)
    })
  }, [onPush])

  return (
    <div
      className="fx-git__stash-overlay"
      data-testid="git-stash"
      role="dialog"
      aria-modal="false"
      aria-label="退避"
    >
      <div className="fx-git__stash-bar">
        <span className="fx-git__stash-title">退避</span>
        {/* 件数は見出しの一部（履歴・変更の一覧と同じ形）。 */}
        {list.status === 'ready' && list.entries.length > 0 ? (
          <span className="fx-git__stash-count">{list.entries.length}</span>
        ) : null}
        <button
          type="button"
          className="fx-git__stash-close"
          onClick={onClose}
          title="退避を閉じる"
          aria-label="退避を閉じる"
        >
          ×
        </button>
      </div>
      <div className="fx-git__stash-body">
        {notice === null ? (
          <ul className="fx-git__stashes">
            {list.entries.map((entry) => (
              <GitStashRowView
                key={entry.shortHash}
                entry={entry}
                now={now}
                operating={operating}
                dropping={dropping === entry.shortHash}
                failure={failure}
                onPop={onPop}
                onDrop={onDrop}
                onOpenRow={openRow}
                onCloseRow={closeRow}
                onOutcome={setFailure}
              />
            ))}
          </ul>
        ) : (
          <p className="fx-git__stash-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      {/*
        切れていることの断りは一覧の**下**に置く（ブランチ・履歴と同じ）──
        上に置くと、開くたびに一番上に現れて、読みたい行の位置が毎回ずれる。
      */}
      {truncation === null ? null : <p className="fx-git__stash-truncated">{truncation}</p>}
      {/*
        新しく避ける（面の下）。

        ブランチの面が一覧の下に作成欄を置いたのとまったく同じ位置になる ──
        上から「今何が避けてあるか → 新しく避ける」と読める。
      */}
      <div className="fx-git__stash-push">
        <button
          type="button"
          className="fx-git__stash-push-button"
          onClick={runPush}
          disabled={!pushReadiness.enabled || pushing}
          // 押せない理由も、押したときに何が起きるかも、同じ場所（hover と読み上げ）に置く。
          title={pushReadiness.note}
          aria-label={pushReadiness.note}
        >
          {pushing ? '退避しています…' : '作業ツリーを退避'}
        </button>
        {/*
          こちらの理由だけは**ボタンの下に出す。** 行の操作と違って押した場所が
          一覧の外にあり、行の下に出すと「どの行のことか」に読まれる。
        */}
        <p className="fx-git__stash-push-note">{pushReadiness.note}</p>
      </div>
      {/*
        行の下に出せない結末（退避そのものの失敗）は、ここに出す。
        行の下に出るものと同じ文言の関数を通る（gitChanges.ts）。
      */}
      {failure === null || dropping !== null ? null : (
        <p className="fx-git__stash-failure" role="alert">
          {describeGitOperationFailure(failure)}
        </p>
      )}
    </div>
  )
}

/**
 * 退避1件の行と、その下に開くもの。
 *
 * ## 行そのものは押せない
 *
 * 履歴の行は押すと詳細が開いたが、こちらは押す先が無い ── 退避の中身を
 * 見る（`git stash show`）は置いていないため（docs/ARCHITECTURE.md §14.23）。
 * **押せる形のものを置かない**ので、押せない理由を言う必要もない
 * （3-8-11 の履歴が `GitActionReadiness` を1つも持たなかったのと同じ形）。
 *
 * 押せるのは右端の2つだけになる。
 *
 *   戻す … 作業ツリーへ戻し、一覧から取り除く
 *   ✕   … 行の下に「捨てる」確認を開く
 *
 * ## 「戻す」は言葉、「捨てる」は記号
 *
 * 大きさを揃えたいのに、**押してよいものと押してはいけないものを同じ形に
 * したくない。** 主たる操作（戻す）を言葉にしてあるのは、それがこの面へ来た
 * 理由だからで、✕ はブランチの一覧と同じ記号・同じ大きさになる。
 */
function GitStashRowView({
  entry,
  now,
  operating,
  dropping,
  failure,
  onPop,
  onDrop,
  onOpenRow,
  onCloseRow,
  onOutcome
}: {
  readonly entry: GitStashEntry
  readonly now: number
  readonly operating: boolean
  /** この行の下に、捨てる確認が開いているか。 */
  readonly dropping: boolean
  readonly failure: GitOperationFailure | null
  readonly onPop: (entry: GitStashEntry) => Promise<GitOperationOutcome | null>
  readonly onDrop: (entry: GitStashEntry) => Promise<GitOperationOutcome | null>
  readonly onOpenRow: (shortHash: string) => void
  readonly onCloseRow: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const row = describeGitStashRow(entry, now)
  const popReadiness = toGitStashPopReadiness(operating)
  const dropReadiness = toGitStashDropReadiness(operating)

  const runPop = useCallback((): void => {
    void onPop(entry).then((outcome) => {
      onOutcome(outcome === null || outcome.status === 'applied' ? null : outcome)
    })
  }, [entry, onPop, onOutcome])

  return (
    <li className="fx-git__stash-entry" data-dropping={dropping}>
      <div className="fx-git__stash-row">
        <div className="fx-git__stash-main">
          <span className="fx-git__stash-subject" data-empty={row.emptySubject} title={row.subject}>
            {row.subject}
          </span>
          <time
            className="fx-git__stash-time"
            dateTime={new Date(entry.stashedAt).toISOString()}
            title={row.absoluteTime}
            aria-label={row.absoluteTime}
          >
            {row.relativeTime}
          </time>
        </div>
        <button
          type="button"
          className="fx-git__stash-pop"
          onClick={runPop}
          disabled={!popReadiness.enabled}
          title={popReadiness.note}
          aria-label={`${row.subject} を作業ツリーへ戻す`}
        >
          戻す
        </button>
        {/*
          ✕ は押すと**その場で git が動くのではなく行の下が開く。**
          `aria-expanded` を持たせてあるのはそのためで、押した結果として
          何かが現れることを、見えていない人にも同じように伝える（3-8-14 と同じ）。
        */}
        <button
          type="button"
          className="fx-git__stash-action"
          onClick={() => onOpenRow(entry.shortHash)}
          disabled={!dropReadiness.enabled}
          aria-expanded={dropping}
          title={dropReadiness.note}
          aria-label={`${row.subject} を捨てる`}
        >
          ✕
        </button>
      </div>
      {dropping ? (
        <GitStashDropConfirm
          entry={entry}
          now={now}
          operating={operating}
          failure={failure}
          onConfirm={onDrop}
          onCancel={onCloseRow}
          onOutcome={onOutcome}
        />
      ) : null}
    </li>
  )
}

/**
 * 行の下に開く「捨てる」の確認（Session 3-8-15）。
 *
 * ## 既定の focus は「やめる」
 *
 * `GitDiscardConfirm` / `GitBranchDeleteConfirm` / `DeleteConfirm` と同じで、
 * Enter を押した勢いでそのまま消えない側を既定にする。**器は違っても、
 * 尋ね方は揃える。**
 *
 * ## 通ったときのことは、ここに書かれていない
 *
 * 捨てると一覧から行そのものが消え、この確認は面の側の後片付けで畳まれる
 * （`GitStashOverlay` の `useEffect`）── 自分で閉じる手順を持たない
 * （3-8-14 とまったく同じ形）。
 */
function GitStashDropConfirm({
  entry,
  now,
  operating,
  failure,
  onConfirm,
  onCancel,
  onOutcome
}: {
  readonly entry: GitStashEntry
  readonly now: number
  readonly operating: boolean
  readonly failure: GitOperationFailure | null
  readonly onConfirm: (entry: GitStashEntry) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
}): JSX.Element {
  const warning = describeGitStashDropWarning(entry, now)

  const confirm = useCallback((): void => {
    void onConfirm(entry).then((outcome) => {
      onOutcome(outcome === null || outcome.status === 'applied' ? null : outcome)
    })
  }, [entry, onConfirm, onOutcome])

  return (
    <div
      className="fx-git__stash-confirm"
      role="alertdialog"
      aria-label="退避を捨てる確認"
      data-testid="git-stash-drop-confirm"
    >
      <p className="fx-git__stash-confirm-message">{warning.message}</p>
      <p className="fx-git__stash-confirm-note">{warning.note}</p>
      <div className="fx-git__stash-confirm-actions">
        <button
          type="button"
          className="fx-git__stash-confirm-button"
          onClick={onCancel}
          // 確認を出す目的は誤操作を止めることなので、既定はこちらに置く。
          autoFocus
        >
          やめる
        </button>
        <button
          type="button"
          className="fx-git__stash-confirm-button"
          data-variant="danger"
          data-testid="git-stash-drop-apply"
          disabled={operating}
          onClick={confirm}
        >
          {warning.confirmLabel}
        </button>
      </div>
      {failure === null ? null : (
        <p className="fx-git__stash-failure" role="alert">
          {describeGitOperationFailure(failure)}
        </p>
      )}
    </div>
  )
}
