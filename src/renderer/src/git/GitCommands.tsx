import { useCommand } from '../commands/useCommand'

/**
 * Git パネルが名乗る command（Session 4-7B）。
 *
 * 画面には何も出さない（`null` を返す）。ここに在るのは**登録の宣言だけ**で、
 * 何が起きるかは GitView から渡ってくる関数が決める。
 *
 * ## なぜ GitView 本体に書けないのか
 *
 * GitView は関数の途中で3回 return する ── 取得中（`status === 'loading'`）・
 * 案内（リポジトリではない / Git が無い）・型の上の保険の3つで、
 * **押せるかどうかの判断（readiness）が計算されるのはその後**になる
 * （GitView.tsx の `commitReady` / `pushReady` …）。
 *
 * hook は条件付きの return より後には置けないため、`useCommand` を GitView の
 * 本体に書くと「readiness を知らないまま登録する」か「hook の順序を壊す」かの
 * どちらかになる。**子にすれば、置いた場所そのものが条件になる。**
 *
 * ## mount が、そのまま「今 Git が使えるか」になる
 *
 * これは Session 4-7A が `when` に `gitRepositoryAvailable` を入れなかった
 * 理由でもある（keybindings/when.ts）── 条件を1つ増やす代わりに、
 * **使えないときは登録しない**で同じ効果が出る。
 *
 * 効き方は2段ある。
 *
 *   1. リポジトリが使えないとき … この component ごと mount されない（GitView）
 *   2. パネルが背面タブのとき  … GitView ごと mount されない
 *      （`workspace/shell/PanelGroup.tsx` は前面のパネルしか描かない）
 *
 * どちらも「今はその操作ができない」であって、失敗ではない
 * （`execute` が false を返し、打鍵は素通りする）。
 *
 * ## 押せる条件を、ここで書き直さない
 *
 * `*Enabled` はどれも**画面のボタンを押せなくしているのと同じ値**を受け取る。
 * GitView が `gitChanges.ts`（Commit / Push / Pull / Fetch の可否）と
 * `gitInProgress.ts`（rebase・cherry-pick などの途中による禁止）から作った
 * 結果をそのまま渡す形にしてあり、ここには判断が1つも無い。
 *
 * **同じ判断を2箇所で書かないため。** ここで条件を組み立て直すと、
 * `withGitInProgressBlock` が被せている禁止を迂回する経路ができる ──
 * Main は断るので事故にはならないが、「押しても必ず失敗する操作」が
 * command として実行できることになる（Session 3-8-2 からの
 * 「押せる操作の数だけ入口を置く」に反する）。
 *
 * ## `git.stashPush` が開くだけなのはなぜか
 *
 * 繋いであるのは `onOpenStash`（退避の面を開く）で、退避そのものは走らない。
 * `stashPush` は確認を1つも挟まずに作業ツリー全体を退避し、しかも結末は
 * 面の中で読ませる設計になっている（useGitRepository.ts の `stashPush`）──
 * 面を閉じたまま実行すると、何が起きたかがパネル下部の1行にしか出ない。
 *
 * id を変えずに挙動だけを寄せてあるのは commands/registry.ts の通りで、
 * 将来「確認を出してから退避する」形に育てるとき、ここだけが変わる。
 *
 * ## 打鍵は1つも持たない
 *
 * `keybindings/defaults.ts` は Session 4-7B で1行も変えていない。
 * 10件とも「登録されているが未割り当て」の状態にあたる
 * （理由は commands/commandIds.ts）。
 */
export function GitCommands({
  onRefresh,
  refreshEnabled,
  onCommit,
  commitEnabled,
  onPush,
  pushEnabled,
  onPull,
  pullEnabled,
  onFetch,
  fetchEnabled,
  onOpenHistory,
  onOpenStash
}: {
  /** 調べ直す（GitView の `refresh`）。 */
  readonly onRefresh: () => void
  /** `⟳` を押せるか（`!busy`）。 */
  readonly refreshEnabled: boolean
  /** 入力欄の中身で Commit する（GitView の `runCommit`）。 */
  readonly onCommit: () => void
  /** Commit ボタンを押せるか（`guardedCommitReady.enabled`）。 */
  readonly commitEnabled: boolean
  readonly onPush: () => void
  /** Push ボタンを押せるか（`pushReady.enabled`）。 */
  readonly pushEnabled: boolean
  readonly onPull: () => void
  /** Pull ボタンを押せるか（`pullReady.enabled`）。 */
  readonly pullEnabled: boolean
  readonly onFetch: () => void
  /** Fetch ボタンを押せるか（`fetchReady.enabled`）。 */
  readonly fetchEnabled: boolean
  /**
   * 履歴の面を開く。
   *
   * 押せなくする条件を持たない ── 何も書き換えない読み取りは、他の Git 操作が
   * 動いていても邪魔にならない（GitView.tsx の履歴ボタンと同じ）。
   */
  readonly onOpenHistory: () => void
  /** 退避の面を開く（**退避そのものは走らない**。上記）。 */
  readonly onOpenStash: () => void
}): null {
  useCommand('git.refresh', onRefresh, refreshEnabled)
  useCommand('git.commit', onCommit, commitEnabled)
  useCommand('git.push', onPush, pushEnabled)
  useCommand('git.pull', onPull, pullEnabled)
  useCommand('git.fetch', onFetch, fetchEnabled)
  useCommand('git.openHistory', onOpenHistory)
  useCommand('git.stashPush', onOpenStash)

  return null
}
