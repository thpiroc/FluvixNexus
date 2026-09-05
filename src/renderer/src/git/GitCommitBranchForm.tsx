import type { FormEvent, JSX } from 'react'
import { useCallback, useState } from 'react'
import type { GitOperationFailure, GitOperationOutcome } from '@shared/git'
import { toGitCommitBranchReadiness } from './gitBranches'
import { describeGitOperationFailure } from './gitChanges'
import type { TFunction } from '../i18n/messages'

/**
 * 履歴の1行の下に開く「この commit からブランチを作る」欄（Session 3-8-13）。
 *
 * ## 面を増やさない
 *
 * 3-8-12 で「面は3枚にしない」と決めてある（docs/ARCHITECTURE.md §14.20）。
 * ここでもその線を保ち、**押した行のすぐ下**に欄を開く ── 別の面を重ねると、
 * 開いた順に `Esc` をほどく数が1つ増え、しかも「どの commit から作るのか」が
 * 画面から離れる。行の下なら、始点はそのまま真上に出ている。
 *
 * ## 失敗の理由をこの中に出す
 *
 * Git パネル本体にも `failure` は出るが（GitView.tsx）、履歴の面が
 * パネルを覆っているため**そこは読めない**。押した場所の近くに出すのは
 * 3-8-3 からの形で、ここでは行の下がその場所になる。
 *
 * 出すのは**この欄から押した1回の結末**だけにしてある ── パネル全体の
 * `failure` を渡すと、履歴を開く前に失敗していた Push の理由が、
 * ブランチを作ろうとしただけの人の目の前に出る。
 *
 * ## 通ったときのことは、ここに書かれていない
 *
 * 作れたら履歴の面ごと閉じる（useGitRepository.ts）── この欄は
 * そのとき一緒に消えるので、閉じる手順を持っていない。失敗したときだけ
 * 残り、打った名前もそのまま残る（Commit 欄・ブランチの作成欄と同じ判断）。
 *
 * ## 文言と押せる条件をここに書かない
 *
 * どちらも gitBranches.ts / gitChanges.ts（React 非依存・テスト対象）が決める。
 * このファイルが持つのは配置だけ、という分担は GitBranchMenu.tsx と同じになる。
 */
export function GitCommitBranchForm({
  shortHash,
  operating,
  onCreate,
  onCancel,
  t
}: {
  /** 始点になる commit の短い hash（履歴の行が持っていたもの）。 */
  readonly shortHash: string
  /** 何かしらの Git 操作が動いている最中か。 */
  readonly operating: boolean
  /** 作る（結末をそのまま返す。通れば面ごと閉じるので、その後は描かれない）。 */
  readonly onCreate: (shortHash: string, name: string) => Promise<GitOperationOutcome | null>
  /** 欄を畳む（`Esc` と「やめる」の両方から来る）。 */
  readonly onCancel: () => void
  readonly t: TFunction
}): JSX.Element {
  const [name, setName] = useState('')
  /*
    押した1回の結末だけを持つ。次に押したら必ず上書きする（`null` を含む）──
    残しておくと、2回目に通ったときに1回目の理由が下に居座る。
  */
  const [failure, setFailure] = useState<GitOperationFailure | null>(null)
  const readiness = toGitCommitBranchReadiness(name, shortHash, operating, t)

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()

      if (!readiness.enabled) {
        return
      }

      void onCreate(shortHash, name).then((outcome) => {
        setFailure(outcome === null || outcome.status === 'applied' ? null : outcome)
      })
    },
    [name, onCreate, readiness.enabled, shortHash]
  )

  return (
    <form className="fx-git__commit-branch-form" onSubmit={submit}>
      <div className="fx-git__commit-branch-row">
        <input
          type="text"
          className="fx-git__branch-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          // 入力そのものは止めない（止めると、貼り付けた名前を自分で削れなくなる）。
          placeholder={t('git.branch.ui.newBranchPlaceholder')}
          aria-label={t('git.branch.createFromCommitEmpty', { hash: shortHash })}
          spellCheck={false}
          autoComplete="off"
          /*
            押した直後に打ち始められるようにする。欄は押したときにだけ現れ、
            現れた理由が「名前を打つため」以外に無い ── 開いてからもう一度
            欄を狙って押す手間を残さない。
          */
          autoFocus
        />
        <button
          type="submit"
          className="fx-git__branch-create-action"
          disabled={!readiness.enabled}
          title={readiness.note}
        >
          {t('git.branch.ui.createButton')}
        </button>
        {/*
          やめる道を、`Esc` の他にも置く（Files の名前の入力欄と同じ）──
          打鍵を知らない人が畳めなくなる。`type="button"` を明示してあるのは、
          `<form>` の中の既定が `submit` のためになる。
        */}
        <button
          type="button"
          className="fx-git__commit-branch-cancel"
          onClick={onCancel}
          title={t('git.branch.ui.cancelTitle')}
          aria-label={t('git.branch.ui.cancelLabel')}
        >
          ×
        </button>
      </div>
      {/*
        何が起きるか / なぜ押せないかを、欄の下に1行だけ出す
        （GitBranchMenu.tsx と同じ形）。打っている最中の人が、指を止めずに読める。
      */}
      <p className="fx-git__branch-note" role="status">
        {readiness.note}
      </p>
      {failure === null ? null : (
        <p className="fx-git__commit-branch-failure" role="alert">
          {describeGitOperationFailure(failure, t)}
        </p>
      )}
    </form>
  )
}
