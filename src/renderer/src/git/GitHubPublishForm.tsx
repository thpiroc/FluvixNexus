import type { FormEvent, JSX } from 'react'
import { useCallback, useState } from 'react'
import type { GitHubRepositoryVisibility } from '@shared/github'
import {
  describeGitHubStatus,
  GITHUB_VISIBILITY_CHOICES,
  toGitHubPublishReadiness,
  toGitHubRepositoryNameSuggestion,
  type GitHubStatusState
} from './githubPublish'
import type { TFunction } from '../i18n/messages'

/**
 * GitHub に公開する面（Session 3-8-10）。
 *
 * DESIGN.md §3 の「初回のみ『GitHub に公開』ボタン」にあたる。出るのは
 * **remote がまだ1つも無いリポジトリ**のときだけで、公開が済めば
 * （remote が設定されれば）この場所ごと消えて、Push / Pull の並びに変わる
 * （GitView.tsx が `repository.hasRemote` で決める）。
 *
 * ## 置き場所は Push / Pull の下
 *
 * 上から「①何が変わったか → ②何と書くか → ③Commit → 送る / 受け取る →
 * 初めて公開する」と読める並びのままで、DESIGN.md 設計判断 2（足すのは下へ）を
 * ここでも動かしていない。
 *
 * ## 畳んである
 *
 * 開くまでは1つのボタンだけになる。名前の欄と公開範囲を最初から広げておくと、
 * **公開する気が無い人の画面にも常に居座る**ことになる ── Git は GitHub の
 * ためだけのものではなく、remote を持たないリポジトリで
 * Commit / Branch / Diff を使い続けるのは普通の使い方にあたる。
 *
 * ## 開いた瞬間に gh を確かめる
 *
 * `onRefreshStatus` を開くたびに呼ぶ（GitBranchMenu.tsx が一覧を取り直すのと
 * 同じ形）── 覚えておいた答えを出すと、gh を入れた直後・ログインした直後に
 * 「見つかりません」のままになる。**そこがいちばん起こりやすい場面**になる。
 *
 * ## 文言と押せる条件をここに書かない
 *
 * どちらも githubPublish.ts（React 非依存・テスト対象）が決める。
 * このファイルが持つのは配置だけ、という分担は GitView.tsx と同じになる。
 */

export function GitHubPublishForm({
  workspaceName,
  status,
  operating,
  publishing,
  onRefreshStatus,
  onPublish,
  t
}: {
  /** Workspace の表示名（repository 名の初期値のもとになる）。 */
  readonly workspaceName: string
  /** GitHub CLI の状態（フックが持つ。useGitRepository.ts）。 */
  readonly status: GitHubStatusState
  /** 何かしらの Git 操作が動いている最中か。 */
  readonly operating: boolean
  /** 公開が動いている最中か。 */
  readonly publishing: boolean
  /** gh の状態を取り直す（面を開いたとき・「もう一度確認する」）。 */
  readonly onRefreshStatus: () => void
  /** 公開できたかどうかを返す（面を閉じてよいか）。 */
  readonly onPublish: (name: string, visibility: GitHubRepositoryVisibility) => Promise<boolean>
  readonly t: TFunction
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<GitHubRepositoryVisibility>('private')

  const start = useCallback((): void => {
    setOpen(true)
    /*
      名前の初期値は開くたびに入れ直さない ── 一度打った名前が、
      閉じて開いただけで消えるのは、失敗の後にいちばん困る
      （`setName` は前の値がある場合そのまま）。
    */
    setName((current) =>
      current === '' ? toGitHubRepositoryNameSuggestion(workspaceName) : current
    )
    onRefreshStatus()
  }, [onRefreshStatus, workspaceName])

  const readiness = toGitHubPublishReadiness(name, status, operating, t)
  const notice = describeGitHubStatus(status, t)

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()

      if (!readiness.enabled) {
        return
      }

      void onPublish(name, visibility).then((published) => {
        /*
          通ったときだけ閉じて空にする（ブランチの作成と同じ判断）──
          失敗のときに閉じると、理由（一覧の上に出る1行）を読む前に
          打った名前まで消えることになる。
        */
        if (published) {
          setName('')
          setOpen(false)
        }
      })
    },
    [name, onPublish, readiness.enabled, visibility]
  )

  if (!open) {
    return (
      <div className="fx-git__publish">
        <button
          type="button"
          className="fx-git__publish-open"
          onClick={start}
          data-testid="github-publish-open"
        >
          {t('git.githubPublish.openButton')}
        </button>
      </div>
    )
  }

  return (
    <form className="fx-git__publish fx-git__publish--open" onSubmit={submit}>
      <div className="fx-git__publish-head">
        <span className="fx-git__publish-title">{t('git.githubPublish.title')}</span>
        <button
          type="button"
          className="fx-git__publish-close"
          onClick={() => setOpen(false)}
          title={t('git.githubPublish.closeTitle')}
          aria-label={t('git.githubPublish.closeLabel')}
        >
          ×
        </button>
      </div>
      {/*
        gh の状態は**入力欄より上**に出す。入っていない・ログインしていない
        場合、名前を打つ前にそこを直す必要があるため ── 下に出すと、
        打ち終わってから「押せない」と気づくことになる。
      */}
      {notice === null ? null : (
        <div className="fx-git__publish-notice" role="status">
          <p className="fx-git__publish-notice-title">{notice.title}</p>
          <p className="fx-git__publish-notice-description">{notice.description}</p>
          {notice.command === null ? null : (
            <code className="fx-git__publish-command">{notice.command}</code>
          )}
          <button type="button" className="fx-git__publish-retry" onClick={onRefreshStatus}>
            {t('git.githubPublish.retry')}
          </button>
        </div>
      )}
      <input
        type="text"
        className="fx-git__publish-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        // 入力そのものは止めない（止めると、貼り付けた名前を自分で削れなくなる）。
        placeholder={t('git.githubPublish.namePlaceholder')}
        aria-label={t('git.githubPublish.nameAria')}
        spellCheck={false}
        autoComplete="off"
      />
      {/*
        公開範囲。**ラジオにしてあるのは、選ばれている方が常に見えている
        必要がある**ため ── 畳まれた選択肢（ドロップダウン）にすると、
        押す瞬間に「今どちらか」を確かめられない。
      */}
      <fieldset className="fx-git__publish-visibility">
        <legend className="fx-git__publish-legend">
          {t('git.githubPublish.visibilityLegend')}
        </legend>
        {GITHUB_VISIBILITY_CHOICES.map((choice) => (
          <label key={choice.value} className="fx-git__publish-choice">
            <input
              type="radio"
              name="fx-git-visibility"
              value={choice.value}
              checked={visibility === choice.value}
              onChange={() => setVisibility(choice.value)}
            />
            <span className="fx-git__publish-choice-label">{t(choice.labelKey)}</span>
            <span className="fx-git__publish-choice-note">{t(choice.noteKey)}</span>
          </label>
        ))}
      </fieldset>
      <div className="fx-git__publish-bar">
        {/*
          何が起きるか / なぜ押せないかを、ボタンの左に1行だけ出す
          （ブランチの作成欄と同じ形）── 打っている最中の人が、
          指を止めずに読める場所にあたる。
        */}
        <span className="fx-git__publish-note" role="status">
          {readiness.note}
        </span>
        <button
          type="submit"
          className="fx-git__publish-action"
          disabled={!readiness.enabled}
          title={readiness.note}
          data-testid="github-publish-apply"
        >
          {publishing ? t('git.githubPublish.publishing') : t('git.githubPublish.publishButton')}
        </button>
      </div>
    </form>
  )
}
