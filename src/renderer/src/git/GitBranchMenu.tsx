import type { FormEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type {
  GitHead,
  GitInProgressOperation,
  GitLocalBranch,
  GitOperationFailure,
  GitOperationOutcome,
  GitRemoteBranch
} from '@shared/git'
import { Popover } from '../ui/Popover'
import { describeGitInProgressBlock, withGitInProgressBlock } from './gitInProgress'
import {
  describeGitBranchDeleteWarning,
  describeGitBranchList,
  describeGitBranchMergeWarning,
  describeGitBranchTruncation,
  toGitBranchCreateReadiness,
  toGitBranchDeleteReadiness,
  toGitBranchMergeReadiness,
  toGitBranchRenameReadiness,
  toGitBranchSwitchReadiness,
  type GitBranchListState
} from './gitBranches'
import {
  describeGitRemoteBranchFreshness,
  describeGitRemoteBranchList,
  describeGitRemoteBranchTruncation,
  toGitRemoteBranchSelectReadiness,
  toGitTrackingBranchCreateReadiness,
  type GitRemoteBranchListState
} from './gitRemoteBranches'
import { describeGitOperationFailure } from './gitChanges'
import { describeGitHead } from './gitRepositoryMessage'
import type { TFunction } from '../i18n/messages'

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
 * ## Session 3-8-19 で、面の3段目に「remote の枝から始める」が付いた
 *
 * 並びは上から3つになる。
 *
 *   1. ローカルの一覧   … 押すと切り替わる
 *   2. 新しく作る欄     … 今の場所から作って切り替わる
 *   3. remote の枝の一覧 … 押すとローカル名の欄が開き、作ると切り替わる
 *
 * **別のボタン・別の面に分けなかった**のが、この回のいちばん大きい配置の
 * 決めごとになる。3-8-6 が一覧と作成を1つの面に置いた理由が、そのまま
 * 3つめにも当てはまるため ──
 *
 * > 「切り替える」と「作って切り替える」は、利用者から見て**同じ場面で
 * > 選ぶこと**になる（今の作業を別の枝で続けたい、というときに、行き先が
 * > 既にあるかどうかは一覧を見て初めて決まる）
 *
 * remote の枝はまさにその続きにあたる ── 一覧を開いて `feature/x` が
 * 無かった人の次の問いは「じゃあ remote には在るのか」で、それが別の面に
 * あると、閉じて別のところを押し直すことになる。上のバーに4つめのボタンを
 * 足す形にしなかったのも同じ理由になる（履歴・退避・リモートは
 * ①〜③の流れの**上に無い**ものだが、これは流れの中にある）。
 *
 * ## 3 は畳んである（既定では閉じている）
 *
 * 1 と 2 は 3-8-6 からそこに在るもので、**開くたびに位置が変わってはいけない。**
 * 3 を常に開くと、ローカルの一覧が長い人ほど下へ押し出され、3-8-6 からの
 * 利用者にとって「作成欄がどこかへ行った」ことになる。畳んでおけば、
 * 増えるのは見出しの1行だけになる。
 *
 * 畳んだ側にも**行の数は出す** ── 開かずに「remote に枝が在るか」が
 * 分かる方が、開いてから空だったと知るより早い。
 *
 * ## `Esc` の段は増えない
 *
 * 3 の中で開くローカル名の欄は、ローカルの一覧の ✎ / ✕ と**同じ `opened`**
 * が持つ（下記）── 一度に開くのは面全体で1つだけで、`Esc` は
 * 「開いているものを畳む → 面を閉じる」の2段のままになる。
 *
 * ## 文言と押せる条件をここに書かない
 *
 * どちらも gitBranches.ts / gitRemoteBranches.ts / gitChanges.ts
 * （React 非依存・テスト対象）が決める。このファイルが持つのは配置だけ、
 * という分担は GitView.tsx と同じになる。
 */

/**
 * 行の下で今開いているもの。
 *
 * 名前と種類の両方を持つのは、**同じ行で ✎ と ✕ を押し替えられる**ようにする
 * ため（片方を開いたまま、もう片方を押したら入れ替わる）。
 *
 * Session 3-8-19 で `track` が加わった ── remote の枝の行の下に開く
 * ローカル名の欄になる。**同じ状態に入れてある**のは、面の中で開くものが
 * 一度に1つであることを、上下の段をまたいで担保するため ── 別の状態に
 * すると、ローカルの行で rename を開いたまま remote の行も開ける形になり、
 * `Esc` がどちらを畳むのかが押した順で決まることになる。
 *
 * 名前が衝突しないのは、remote-tracking branch の名前が必ず `<remote>/` で
 * 始まるためではない（ローカルにも `origin/x` という名前は作れる）──
 * `mode` まで含めて一致を見るためになる。
 */
interface OpenedBranchRow {
  readonly name: string
  readonly mode: 'delete' | 'rename' | 'track' | 'merge'
}

export function GitBranchMenu({
  head,
  list,
  remoteList,
  operating,
  inProgress,
  onOpen,
  onSwitch,
  onCreate,
  onDelete,
  onRename,
  onMerge,
  onCreateTracking,
  t
}: {
  /** 今 HEAD がどこを指しているか（ボタンの文字になる）。 */
  readonly head: GitHead
  /** 一覧の今の姿（フックが持つ。useGitRepository.ts）。 */
  readonly list: GitBranchListState
  /** remote-tracking branch の一覧の今の姿（Session 3-8-19）。 */
  readonly remoteList: GitRemoteBranchListState
  /** 何かしらの Git 操作が動いている最中か。 */
  readonly operating: boolean
  /**
   * 途中の Git 操作（Session 3-8-20 / 3-8-22A）。
   *
   * `head` と同じく状態から来る（shared/git/repository.ts）── 面が自分で
   * 推し量らないのは、「競合の行があるか」からは導けないためになる。
   * 使うのは行のマージの口を押せなくするためだけで、**中止の口はここに
   * 置かない**（パネルの帯にある。GitView.tsx）── 面を開かないと
   * 中止できない形にすると、いちばん出口が要る状態で出口が隠れる。
   *
   * 3-8-20 では真偽1つ（`merging`）だった。4つに広げたことで、
   * **rebase の途中でも押せてしまっていた**穴が塞がる（`MERGE_HEAD` が
   * 無いので、あの形では偽だった。gitBranches.ts）。
   */
  readonly inProgress: GitInProgressOperation | null
  /** 面が開いた（一覧を取り直す契機 ── 3-8-19 から2本とも取り直す）。 */
  readonly onOpen: () => void
  readonly onSwitch: (name: string) => void
  /** 作れたかどうかを返す（入力欄を空にしてよいか・面を閉じてよいか）。 */
  readonly onCreate: (name: string) => Promise<boolean>
  /** 削除する（結末をそのまま返す ── 理由を行の下に出すため）。 */
  readonly onDelete: (name: string) => Promise<GitOperationOutcome | null>
  /** 名前を変える（結末をそのまま返す）。 */
  readonly onRename: (name: string, newName: string) => Promise<GitOperationOutcome | null>
  /** 今のブランチへ取り込む（結末をそのまま返す。Session 3-8-20）。 */
  readonly onMerge: (name: string) => Promise<GitOperationOutcome | null>
  /** remote の枝を追うブランチを作る（結末をそのまま返す。Session 3-8-19）。 */
  readonly onCreateTracking: (
    startPoint: string,
    name: string
  ) => Promise<GitOperationOutcome | null>
  readonly t: TFunction
}): JSX.Element {
  const notice = describeGitBranchList(list, t)
  const truncation = describeGitBranchTruncation(list, t)
  /*
    ボタンの文字は、それまでバーに出ていたものとまったく同じ関数から出す
    （gitRepositoryMessage.ts）── 押せる場所になった、というだけの変更で、
    「今どこに居るか」の言い方まで変える理由が無い。
  */
  const label = describeGitHead(head, t)

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

    /*
      どちらの一覧を見るかは、開いているものの種類で決まる（Session 3-8-19）──
      `track` はローカルの一覧に居ないので、ここでローカルだけを見ていると
      **remote の行の欄が、開いた瞬間に畳まれる。**
    */
    const source = opened.mode === 'track' ? remoteList.branches : list.branches

    if (!source.some((branch) => branch.name === opened.name)) {
      setOpened(null)
    }
  }, [list.branches, remoteList.branches, opened])

  return (
    <Popover
      label={label}
      buttonClassName="fx-git__branch-button"
      buttonLabel={t('git.panel.branchButtonTitle', { label })}
      role="dialog"
      panelLabel={t('git.panel.branchPanelLabel')}
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
                  head={head}
                  operating={operating}
                  inProgress={inProgress}
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
                  onMerge={onMerge}
                  onMerged={close}
                  onOutcome={setFailure}
                  t={t}
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
          <GitBranchCreateForm
            operating={operating}
            blocked={describeGitInProgressBlock(inProgress, 'create-branch', t)}
            onCreate={onCreate}
            onCreated={close}
            t={t}
          />
          {/*
            remote の枝から始める（Session 3-8-19）。

            いちばん下に置く ── DESIGN.md 設計判断 2（足すのは下へ）のとおりで、
            上から「今どこに居るか → どこへ行けるか → 新しく作る →
            remote から持ってくる」と読める。3-8-6 からそこに在った2つの
            位置を1mm も動かさない。
          */}
          <GitRemoteBranchSection
            list={remoteList}
            operating={operating}
            blocked={describeGitInProgressBlock(inProgress, 'create-tracking-branch', t)}
            opened={opened !== null && opened.mode === 'track' ? opened.name : null}
            failure={failure}
            onOpenRow={openRow}
            onCloseRow={closeRow}
            onCreateTracking={onCreateTracking}
            onOutcome={setFailure}
            onCreated={close}
            t={t}
          />
        </>
      )}
    </Popover>
  )
}

/**
 * 「リモートのブランチから作る」の畳んだ塊（Session 3-8-19）。
 *
 * ## 開閉はこの塊が持つ
 *
 * 面の側（`GitBranchMenu`）に持たせない ── 面が持っている `opened` は
 * 「行の下に何が開いているか」で、こちらは「段そのものが開いているか」に
 * なる。混ぜると、remote の行の欄を畳んだときに段まで閉じることになる。
 *
 * ## 閉じるときに、中の欄も畳む
 *
 * 段を閉じてから開き直したとき、前に打ちかけていたローカル名が
 * そのまま出ていると、今どの行について何をしようとしているのかが
 * 分からなくなる（面を開き直したときに `closeRow` するのと同じ判断）。
 *
 * ## 件数は畳んだ状態でも出す
 *
 * 開かずに「remote に枝が在るか」が分かる方が、開いてから空だったと知るより
 * 早い ── ただし出すのは `ready` のときだけになる。取得中や失敗のときに
 * 「0」と出すと、**在るのに無いと読まれる。**
 */
function GitRemoteBranchSection({
  list,
  operating,
  blocked,
  opened,
  failure,
  onOpenRow,
  onCloseRow,
  onCreateTracking,
  onOutcome,
  onCreated,
  t
}: {
  readonly list: GitRemoteBranchListState
  readonly operating: boolean
  /**
   * 途中の Git 操作があるために、手元に作れない理由（Session 3-8-22A）。
   * 作れるなら null。
   *
   * この口は**作って切り替える**ので、3-8-6 の作成とまったく同じ危うさを
   * 持つ（shared/git/inProgress.ts）。段の中で判断せず、面が表から引いた
   * 答えをそのまま受け取る。
   */
  readonly blocked: string | null
  /** この段の中で開いている行の名前（無ければ null）。 */
  readonly opened: string | null
  readonly failure: GitOperationFailure | null
  readonly onOpenRow: (row: OpenedBranchRow) => void
  readonly onCloseRow: () => void
  readonly onCreateTracking: (
    startPoint: string,
    name: string
  ) => Promise<GitOperationOutcome | null>
  readonly onOutcome: (failure: GitOperationFailure | null) => void
  /** 通ったので面を閉じる（作った先へ切り替わっている）。 */
  readonly onCreated: () => void
  readonly t: TFunction
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const notice = describeGitRemoteBranchList(list, t)
  const truncation = describeGitRemoteBranchTruncation(list, t)
  const freshness = describeGitRemoteBranchFreshness(list, t)

  const toggle = useCallback((): void => {
    setExpanded((current) => {
      if (current) {
        // 畳むときは、中で開いていた欄も一緒に片付ける。
        onCloseRow()
      }

      return !current
    })
  }, [onCloseRow])

  const count = list.status === 'ready' ? list.branches.length : null

  return (
    <div className="fx-git__remote-branches" data-expanded={expanded}>
      <button
        type="button"
        className="fx-git__remote-branches-toggle"
        onClick={toggle}
        aria-expanded={expanded}
        title={t('git.branch.ui.remoteSectionTitle')}
      >
        <span className="fx-git__remote-branches-caret" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="fx-git__remote-branches-title">
          {t('git.branch.ui.remoteSectionLabel')}
        </span>
        {count === null ? null : (
          <span className="fx-git__remote-branches-count">{count.toLocaleString()}</span>
        )}
      </button>
      {expanded ? (
        <>
          <div className="fx-git__remote-branch-list">
            {notice === null ? (
              list.branches.map((branch) => (
                <GitRemoteBranchRow
                  key={branch.name}
                  branch={branch}
                  operating={operating}
                  blocked={blocked}
                  opened={opened === branch.name}
                  failure={failure}
                  onOpenRow={onOpenRow}
                  onCloseRow={onCloseRow}
                  onCreateTracking={onCreateTracking}
                  onOutcome={onOutcome}
                  onCreated={onCreated}
                  t={t}
                />
              ))
            ) : (
              <p className="fx-git__branch-notice" role="status">
                {notice}
              </p>
            )}
          </div>
          {truncation === null ? null : <p className="fx-git__branch-truncated">{truncation}</p>}
          {/*
            いつの写しなのかを黙らない（gitRemoteBranches.ts）── この面は
            fetch しないので、黙ると「今の remote の状態」として読まれる。
          */}
          {freshness === null ? null : <p className="fx-git__branch-truncated">{freshness}</p>}
        </>
      ) : null}
    </div>
  )
}

/**
 * remote の枝の1行と、その下に開くローカル名の欄（Session 3-8-19）。
 *
 * ## 押しても切り替わらない
 *
 * ローカルの一覧の行は押すと切り替わるが、こちらは**欄が開くだけ**になる ──
 * 「選んだら手元にブランチが作られる」という、一覧を見ただけでは分からない
 * 副作用を作らない、という 3-8-6 からの決めごとがここに現れる
 * （shared/git/branch.ts）。`aria-expanded` を持たせてあるのはそのためで、
 * 押した結果として何かが現れることを、見えていない人にも同じように伝える。
 *
 * ## ✎ / ✕ は無い
 *
 * remote branch の削除も rename も対象外にしてある（§14.22 のまま）── 他人に
 * 影響し、サーバー側で戻せない。行に置けるのは1つだけなので、
 * ローカルの行のようにボタンを分けていない。
 */
function GitRemoteBranchRow({
  branch,
  operating,
  blocked,
  opened,
  failure,
  onOpenRow,
  onCloseRow,
  onCreateTracking,
  onOutcome,
  onCreated,
  t
}: {
  readonly branch: GitRemoteBranch
  readonly operating: boolean
  /** 手元に作れない理由（Session 3-8-22A）。作れるなら null。 */
  readonly blocked: string | null
  readonly opened: boolean
  readonly failure: GitOperationFailure | null
  readonly onOpenRow: (row: OpenedBranchRow) => void
  readonly onCloseRow: () => void
  readonly onCreateTracking: (
    startPoint: string,
    name: string
  ) => Promise<GitOperationOutcome | null>
  readonly onOutcome: (failure: GitOperationFailure | null) => void
  readonly onCreated: () => void
  readonly t: TFunction
}): JSX.Element {
  /*
    行を押すこと自体は「下の欄を開く」だけだが、開いた先でできることが
    無いなら開かせない（Session 3-8-22A）── 開いてから欄の中で断られるより、
    押す前に理由が読める方が短い（3-8-19 が「同名があれば git を動かす前に
    断る」としたのと同じ側）。
  */
  const readiness = withGitInProgressBlock(
    toGitRemoteBranchSelectReadiness(branch, operating, t),
    blocked
  )

  return (
    <div className="fx-git__branch-entry">
      <div className="fx-git__branch-item">
        <button
          type="button"
          className="fx-menu__item fx-git__branch-switch"
          onClick={() => onOpenRow({ name: branch.name, mode: 'track' })}
          disabled={!readiness.enabled}
          aria-expanded={opened}
          title={readiness.note}
          aria-label={readiness.note}
        >
          {/* 印の場所はローカルの一覧と揃える（名前の開始位置を行ごとに動かさない）。 */}
          <span className="fx-menu__mark" aria-hidden="true" />
          <span className="fx-menu__label fx-git__branch-name">{branch.name}</span>
        </button>
      </div>
      {opened ? (
        <GitTrackingBranchForm
          branch={branch}
          operating={operating}
          blocked={blocked}
          failure={failure}
          onCreateTracking={onCreateTracking}
          onCancel={onCloseRow}
          onOutcome={onOutcome}
          onCreated={onCreated}
          t={t}
        />
      ) : null}
    </div>
  )
}

/**
 * 行の下に開くローカル名の欄（Session 3-8-19）。
 *
 * ## 初期値は remote 側の branch 部分
 *
 * `origin/feature/x` を押したら `feature/x` が入っている ── いちばん多い答えを
 * 打たせないためになる。切り出したのは Main で（remote 名に `/` が入りうるため、
 * Renderer では正しく切れない。shared/git/remoteBranch.ts）、
 * ここはそれを初期値に置くだけになる。
 *
 * rename の欄と同じく開いた瞬間に全選択してあるので、まるごと差し替えたい人は
 * そのまま打てる。
 *
 * ## それでも欄にしてある（決め打ちにしない）
 *
 * 押しただけで作る形にすると、**同じ名前のローカルブランチが既にある人に
 * 打ち直す道が無くなる** ── アプリは上書きも削除も自動切替もしないので
 * （main/git/gitRemoteBranches.ts）、そのとき次の一手は「別の名前にする」
 * ただ1つになる。その欄が同じ場所に在ることが要る。
 *
 * ## 失敗しても名前を消さない
 *
 * Commit 欄・作成欄・rename 欄と同じ判断 ── 「同じ名前が既にあります」と
 * 言われた人が、また一から打ち直すことになる。
 *
 * ## 通ったら面ごと閉じる
 *
 * 作った先へ切り替わるので、開いたままの一覧は**もう別のブランチのもの**に
 * なる（ローカルの一覧の印が全部ずれる）── 3-8-6 の作成と同じ扱いで、
 * 削除 / rename が閉じないのとは逆側にあたる。
 */
function GitTrackingBranchForm({
  branch,
  operating,
  blocked,
  failure,
  onCreateTracking,
  onCancel,
  onOutcome,
  onCreated,
  t
}: {
  readonly branch: GitRemoteBranch
  readonly operating: boolean
  /** 手元に作れない理由（Session 3-8-22A）。作れるなら null。 */
  readonly blocked: string | null
  readonly failure: GitOperationFailure | null
  readonly onCreateTracking: (
    startPoint: string,
    name: string
  ) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
  readonly onCreated: () => void
  readonly t: TFunction
}): JSX.Element {
  const [name, setName] = useState(branch.branch)
  const readiness = withGitInProgressBlock(
    toGitTrackingBranchCreateReadiness(branch, name, operating, t),
    blocked
  )

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()

      if (!readiness.enabled) {
        return
      }

      void onCreateTracking(branch.name, name).then((outcome) => {
        if (outcome !== null && outcome.status === 'applied') {
          onOutcome(null)
          onCreated()
          return
        }

        onOutcome(outcome === null ? null : outcome)
      })
    },
    [branch.name, name, onCreateTracking, onCreated, onOutcome, readiness.enabled]
  )

  return (
    <form
      className="fx-git__branch-rename"
      onSubmit={submit}
      data-testid="git-tracking-branch-form"
      data-branch={branch.name}
    >
      <div className="fx-git__branch-rename-row">
        <input
          type="text"
          className="fx-git__branch-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          // 入力そのものは止めない（止めると、貼り付けた名前を自分で削れなくなる）。
          aria-label={t('git.branch.ui.trackNameAria', { name: branch.name })}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="submit"
          className="fx-git__branch-create-action"
          data-testid="git-tracking-branch-apply"
          disabled={!readiness.enabled}
          title={readiness.note}
        >
          {t('git.branch.ui.createButton')}
        </button>
        {/*
          やめる道を `Esc` の他にも置く（rename の欄と同じ）。`type="button"` を
          明示してあるのは、`<form>` の中の既定が `submit` のためになる。
        */}
        <button
          type="button"
          className="fx-git__branch-rename-cancel"
          onClick={onCancel}
          title={t('git.branch.ui.cancelTitle')}
          aria-label={t('git.branch.ui.cancelLabel')}
        >
          ×
        </button>
      </div>
      <p className="fx-git__branch-note" role="status">
        {readiness.note}
      </p>
      {failure === null ? null : (
        <p className="fx-git__branch-failure" role="alert">
          {describeGitOperationFailure(failure, t)}
        </p>
      )}
    </form>
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
  head,
  operating,
  inProgress,
  opened,
  failure,
  onSelect,
  onOpenRow,
  onCloseRow,
  onDelete,
  onRename,
  onMerge,
  onMerged,
  onOutcome,
  t
}: {
  readonly branch: GitLocalBranch
  readonly head: GitHead
  readonly operating: boolean
  readonly inProgress: GitInProgressOperation | null
  /** この行の下で開いているもの（無ければ null）。 */
  readonly opened: OpenedBranchRow['mode'] | null
  readonly failure: GitOperationFailure | null
  readonly onSelect: () => void
  readonly onOpenRow: (row: OpenedBranchRow) => void
  readonly onCloseRow: () => void
  readonly onDelete: (name: string) => Promise<GitOperationOutcome | null>
  readonly onRename: (name: string, newName: string) => Promise<GitOperationOutcome | null>
  readonly onMerge: (name: string) => Promise<GitOperationOutcome | null>
  /** マージが始まったので面を閉じる（続きはパネル本体にある）。 */
  readonly onMerged: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
  readonly t: TFunction
}): JSX.Element {
  /*
    途中の Git 操作による禁止（Session 3-8-22A）。

    **3つを別々に聞いている。** 答えが揃っていないためになる ── マージの
    途中では切り替えだけが通らず、削除と改名は通る（ref を1つ動かすだけで
    `MERGE_HEAD` に触らない）。rebase / cherry-pick / revert では3つとも
    通らない。まとめて1つの真偽にすると、その違いがここで消える
    （shared/git/inProgress.ts）。

    マージの口だけは `toGitBranchMergeReadiness` の中で同じ表を読んでいる ──
    あちらは「今このブランチに居る」という別の理由を先に返す必要があり、
    その順番を外から被せる形では表せない。
  */
  const switchReadiness = withGitInProgressBlock(
    toGitBranchSwitchReadiness(branch, operating, t),
    describeGitInProgressBlock(inProgress, 'switch-branch', t)
  )
  const deleteReadiness = withGitInProgressBlock(
    toGitBranchDeleteReadiness(branch, operating, t),
    describeGitInProgressBlock(inProgress, 'delete-branch', t)
  )
  const renameBlocked = describeGitInProgressBlock(inProgress, 'rename-branch', t)
  const mergeReadiness = toGitBranchMergeReadiness(branch, head, inProgress, operating, t)
  /*
    今のブランチ（と detached）の行にはマージの口を出さない
    （gitBranches.ts）── 自分自身を取り込むのは操作として意味を成さず、
    薄いボタンを置くと「条件が揃えば押せるもの」に見える。

    **場所は空けたまま残す**（下の `<span>`）── 消すと、行ごとにボタンの
    数が変わって ✎ / ✕ の位置が縦に揃わなくなる（3-8-14 で ✕ を薄くして
    残したのと同じ判断）。
  */
  const mergeVisible = !branch.current && head.kind === 'branch'

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
          {branch.current ? (
            <span className="fx-menu__hint">{t('git.branch.ui.currentHint')}</span>
          ) : null}
        </button>
        {/*
          ⤵（今のブランチへ取り込む。Session 3-8-20）。

          ## 置き場所は ✎ / ✕ の**手前**

          いちばん右（✕ ＝ 消す）を動かさないため ── 一覧を縦に読む人が
          頼りにしているのは「右端は消す側」という並びで、そこに
          別のものを差し込むと、3-8-14 からの押し方が変わる。

          ## 押すとその場で git が動くのではなく、行の下が開く

          ✎ / ✕ とまったく同じ形になる（`aria-expanded`）。3-8-20 で
          いちばん避けたいのは**切り替えるつもりで押してマージが始まる**
          ことで、確認はそのために在る（gitBranches.ts）。
        */}
        {mergeVisible ? (
          <button
            type="button"
            className="fx-git__branch-action"
            data-action="merge"
            onClick={() => onOpenRow({ name: branch.name, mode: 'merge' })}
            disabled={!mergeReadiness.enabled}
            aria-expanded={opened === 'merge'}
            title={mergeReadiness.note}
            aria-label={t('git.branch.ui.mergeAria', { name: branch.name })}
          >
            ⤵
          </button>
        ) : (
          <span className="fx-git__branch-action" aria-hidden="true" />
        )}
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
          title={t('git.branch.ui.renameTitle', { name: branch.name })}
          aria-label={t('git.branch.ui.renameAria', { name: branch.name })}
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
          aria-label={t('git.branch.ui.deleteAria', { name: branch.name })}
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
          t={t}
        />
      ) : null}

      {opened === 'rename' ? (
        <GitBranchRenameForm
          branch={branch}
          operating={operating}
          blocked={renameBlocked}
          failure={failure}
          onRename={onRename}
          onCancel={onCloseRow}
          onOutcome={onOutcome}
          t={t}
        />
      ) : null}

      {opened === 'merge' ? (
        <GitBranchMergeConfirm
          branch={branch}
          head={head}
          operating={operating}
          failure={failure}
          onConfirm={onMerge}
          onCancel={onCloseRow}
          onMerged={onMerged}
          onOutcome={onOutcome}
          t={t}
        />
      ) : null}
    </div>
  )
}

/**
 * 行の下に開くマージの確認（Session 3-8-20）。
 *
 * ## Git で確認を挟む、3つめ
 *
 * 1つめは破棄（§14.16）、2つめはブランチの削除（§14.22）── どちらも
 * 「消える」ことへの確認だった。**マージでは何も消えない。** それでも
 * 挟むのは、押す場所が切り替えの行の上（1文字分の距離）にあり、
 * 誤って押すと**履歴に merge commit が積まれる**ためになる ── その取り消し
 * （`reset`）はアプリが持たず、行き先は Terminal パネルになる。
 *
 * ## 器は削除の確認と同じ
 *
 * 見た目も並びも `GitBranchDeleteConfirm` をそのまま踏襲する ── 尋ね方を
 * 揃えるのは 3-8-14 からの決めごとで、既定の focus は「やめる」、
 * 実行は右になる。**`data-variant="danger"` は付けない**（消す操作ではない）。
 *
 * ## 通っても競合しても閉じる。通らなかったときだけ開いたままにする
 *
 * 通れば、この面でやることはもう無い。**競合した場合も閉じる** ──
 * 次にすること（競合の解決 → Commit）は面の中ではなく、パネル本体の
 * 一覧に在るためで、面が被さっていると見えない。
 *
 * 逆に `failed`（作業ツリーが邪魔・相手が消えた）では閉じない ── 3-8-14 の
 * 削除 / rename と同じ判断で、**理由を読む前に押した行が消えない**ように
 * するためになる。
 */
function GitBranchMergeConfirm({
  branch,
  head,
  operating,
  failure,
  onConfirm,
  onCancel,
  onMerged,
  onOutcome,
  t
}: {
  readonly branch: GitLocalBranch
  readonly head: GitHead
  readonly operating: boolean
  readonly failure: GitOperationFailure | null
  readonly onConfirm: (name: string) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onMerged: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
  readonly t: TFunction
}): JSX.Element {
  const warning = describeGitBranchMergeWarning(branch, head, t)

  const confirm = useCallback((): void => {
    void onConfirm(branch.name).then((outcome) => {
      if (outcome === null) {
        return
      }

      /*
        通らなかった（`failed`）── 行の下に理由を出し、面は開けたままにする。
        押した行がその場に残っていないと、出ている理由がどれについてのものか
        分からなくなる（3-8-14 の削除 / rename と同じ）。
      */
      if (outcome.status === 'failed') {
        onOutcome(outcome)
        return
      }

      /*
        通った（`applied`）か、競合した（`partly-applied`）── どちらも
        続きは面の外にある。競合の理由はパネル本体の1行に出る
        （GitView.tsx が同じ結末から出す）。
      */
      onOutcome(null)
      onMerged()
    })
  }, [branch.name, onConfirm, onMerged, onOutcome])

  return (
    <div
      className="fx-git__branch-confirm"
      role="alertdialog"
      aria-label={t('git.branch.ui.mergeConfirmAria', { name: branch.name })}
      data-testid="git-branch-merge-confirm"
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
          {t('git.branch.ui.cancelLabel')}
        </button>
        <button
          type="button"
          className="fx-git__branch-confirm-button"
          data-testid="git-branch-merge-apply"
          disabled={operating}
          onClick={confirm}
        >
          {warning.confirmLabel}
        </button>
      </div>
      {failure === null ? null : (
        <p className="fx-git__branch-failure" role="alert">
          {describeGitOperationFailure(failure, t)}
        </p>
      )}
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
  onOutcome,
  t
}: {
  readonly branch: GitLocalBranch
  readonly operating: boolean
  readonly failure: GitOperationFailure | null
  readonly onConfirm: (name: string) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
  readonly t: TFunction
}): JSX.Element {
  const warning = describeGitBranchDeleteWarning(branch, t)

  const confirm = useCallback((): void => {
    void onConfirm(branch.name).then((outcome) => {
      onOutcome(outcome === null || outcome.status === 'applied' ? null : outcome)
    })
  }, [branch.name, onConfirm, onOutcome])

  return (
    <div
      className="fx-git__branch-confirm"
      role="alertdialog"
      aria-label={t('git.branch.ui.deleteConfirmAria', { name: branch.name })}
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
          {t('git.branch.ui.cancelLabel')}
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
          {describeGitOperationFailure(failure, t)}
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
  blocked,
  failure,
  onRename,
  onCancel,
  onOutcome,
  t
}: {
  readonly branch: GitLocalBranch
  readonly operating: boolean
  /** 途中の Git 操作があるために通せない理由（Session 3-8-22A）。無ければ null。 */
  readonly blocked: string | null
  readonly failure: GitOperationFailure | null
  readonly onRename: (name: string, newName: string) => Promise<GitOperationOutcome | null>
  readonly onCancel: () => void
  readonly onOutcome: (failure: GitOperationFailure | null) => void
  readonly t: TFunction
}): JSX.Element {
  const [newName, setNewName] = useState(branch.name)
  const readiness = withGitInProgressBlock(
    toGitBranchRenameReadiness(branch, newName, operating, t),
    blocked
  )

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
          aria-label={t('git.branch.ui.renameInputAria', { name: branch.name })}
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
          {t('git.branch.ui.changeButton')}
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
          title={t('git.branch.ui.cancelTitle')}
          aria-label={t('git.branch.ui.cancelLabel')}
        >
          ×
        </button>
      </div>
      <p className="fx-git__branch-note" role="status">
        {readiness.note}
      </p>
      {failure === null ? null : (
        <p className="fx-git__branch-failure" role="alert">
          {describeGitOperationFailure(failure, t)}
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
  blocked,
  onCreate,
  onCreated,
  t
}: {
  readonly operating: boolean
  /** 途中の Git 操作があるために通せない理由（Session 3-8-22A）。無ければ null。 */
  readonly blocked: string | null
  readonly onCreate: (name: string) => Promise<boolean>
  readonly onCreated: () => void
  readonly t: TFunction
}): JSX.Element {
  const [name, setName] = useState('')
  const readiness = withGitInProgressBlock(toGitBranchCreateReadiness(name, operating, t), blocked)

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
          placeholder={t('git.branch.ui.newBranchPlaceholder')}
          aria-label={t('git.branch.ui.newBranchAria')}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="fx-git__branch-create-action"
          disabled={!readiness.enabled}
          title={readiness.note}
        >
          {t('git.branch.ui.createButton')}
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
