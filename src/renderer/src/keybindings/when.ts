/**
 * ショートカットが効く条件（Session 4-7A）。
 *
 * React にも DOM にも依存しない純粋な層。**「今どういう状態か」を集めるのは
 * KeybindingProvider の仕事**で、ここが持つのは「その状態でこの rule は通るか」
 * という判定だけになる（`terminal/terminalDisplay.ts` が `KeyboardEvent` ではなく
 * `TerminalKeyStroke` を受け取るのと同じ切り方）。
 *
 * ## 式は書けない。閉じた集合の AND だけ
 *
 * VS Code の `when` は `&&` / `||` / `!` / `==` / 正規表現まで持つ式言語だが、
 * **あれは基盤より大きいサブシステム**にほかならない。v1 では
 *
 *   - 条件は `WHEN_KEYS` に載っている6つだけ
 *   - 並べたものは AND（`['a', '!b']` は「a かつ b でない」）
 *   - 否定は先頭の `!` 1文字だけ
 *
 * とする。`WhenClause` が `WhenKey | `!${WhenKey}`` という**型で閉じた union**
 * なので、綴りの間違いは型エラーになる ── 文字列を解析する必要が無い。
 *
 * 将来この形が足りなくなったら式パーサへ移せる。`['a', '!b']` は
 * `'a && !b'` と1対1に対応するため、保存形式を変えずに読み替えられる。
 *
 * ## 6つに絞った理由
 *
 * 増やすのは簡単だが、**条件は「誰かがその値を供給する」ことで初めて意味を持つ**。
 * 供給元が無い条件を先に作ると、常に false（＝そのショートカットは永久に効かない）
 * になる。ここに並ぶ6つはすべて Session 4-7A の時点で供給元がある。
 *
 * | 条件                 | 供給元                                                    |
 * | -------------------- | --------------------------------------------------------- |
 * | `workspaceOpen`      | `useWorkspaceFolder().workspace !== null`                  |
 * | `editorHasActiveTab` | `useEditorContext().activeTab !== null`                    |
 * | `editorFocused`      | DOM（`[data-panel-body="editor"]` の中に focus があるか）  |
 * | `terminalFocused`    | DOM（`[data-panel-body="terminal"]` の中に focus があるか）|
 * | `settingsOpen`       | WorkspaceShell が `useWhenFlag` で申告する                 |
 * | `modalOpen`          | DOM（`[aria-modal="true"]` が出ているか）                  |
 *
 * `gitRepositoryAvailable` は入れていない。`useGitRepository()` は Git パネルの中
 * にあり、これを Shell 全体から読める場所へ出すと「パネルの事情を Shell が知る」
 * ことになる（`workspace/panels/GitPanel.tsx` が守っている分担）。
 * **Git が使えないときは Git の command が登録されない**、で同じ効果が得られる
 * （Session 4-7B）。
 */

/**
 * 既知の条件。
 *
 * 順序に意味は無い（AND なので）。読む人が追いやすいよう、
 * 「何が開いているか」→「どこに focus があるか」→「何が手前にあるか」で並べてある。
 */
export const WHEN_KEYS = [
  'workspaceOpen',
  'editorHasActiveTab',
  'editorFocused',
  'terminalFocused',
  'settingsOpen',
  'modalOpen'
] as const

/** 既知の条件。ここに無い名前は条件ではない。 */
export type WhenKey = (typeof WHEN_KEYS)[number]

/** rule に書ける形（`'editorFocused'` / `'!terminalFocused'`）。 */
export type WhenClause = WhenKey | `!${WhenKey}`

/** 打鍵が届いた瞬間の状態。**すべての条件が必ず入る**（欠けた条件を作らない）。 */
export type WhenContext = Readonly<Record<WhenKey, boolean>>

/** 何も成り立っていない状態（テストと、状態を集められない場面の土台）。 */
export function emptyWhenContext(): WhenContext {
  return {
    workspaceOpen: false,
    editorHasActiveTab: false,
    editorFocused: false,
    terminalFocused: false,
    settingsOpen: false,
    modalOpen: false
  }
}

/** 素の値が既知の条件名か。 */
export function isWhenKey(value: unknown): value is WhenKey {
  return typeof value === 'string' && (WHEN_KEYS as readonly string[]).includes(value)
}

/** 解析済みの1つの条件。 */
export interface ParsedWhenClause {
  readonly key: WhenKey
  readonly negated: boolean
}

/**
 * 1つの条件を読む。**読めなければ null。**
 *
 * 型の上では読めない値は来ないが、将来 `keybindings.json` から来る文字列は
 * 素の string になる。そのときここが唯一の関門になるよう、引数を広く取ってある
 * （`isCommandId` を先に置いてあるのと同じ理由）。
 */
export function parseWhenClause(clause: string): ParsedWhenClause | null {
  const negated = clause.startsWith('!')
  const key = negated ? clause.slice(1) : clause

  return isWhenKey(key) ? { key, negated } : null
}

/**
 * その rule が今の状態で通るか。
 *
 * 条件が1つも無ければ常に通る（＝どこでも効く）。
 *
 * **読めない条件が1つでもあれば通さない（fail-closed）。** 逆にすると、
 * 綴りを間違えた条件や、この版が知らない条件を持つ rule が
 * 「条件が無いのと同じ」＝**どこでも効く**ようになる ── 条件を書いた意図と
 * 正反対の壊れ方になる。
 */
export function matchesWhen(when: readonly string[] | undefined, context: WhenContext): boolean {
  if (when === undefined || when.length === 0) {
    return true
  }

  return when.every((clause) => {
    const parsed = parseWhenClause(clause)

    if (parsed === null) {
      return false
    }

    return context[parsed.key] !== parsed.negated
  })
}

/**
 * 2つの条件の並びが**同時に成り立ちうるか**。
 *
 * 競合の検出（resolve.ts の `findKeybindingConflicts`）で使う。同じ打鍵でも
 * 「Editor に focus があるとき」と「Terminal に focus があるとき」なら
 * ぶつからない ── 両立しない条件を1つでも持っていれば別物として扱う。
 *
 * 読めない条件は「分からない」ので、重なりうる側へ倒す（見逃すより出しすぎる方が、
 * 競合の一覧としては安全）。
 */
export function whenOverlaps(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): boolean {
  const required = new Map<WhenKey, boolean>()

  for (const clause of a ?? []) {
    const parsed = parseWhenClause(clause)

    if (parsed !== null) {
      required.set(parsed.key, !parsed.negated)
    }
  }

  for (const clause of b ?? []) {
    const parsed = parseWhenClause(clause)

    if (parsed === null) {
      continue
    }

    const other = required.get(parsed.key)

    if (other !== undefined && other === parsed.negated) {
      // 片方が true を、もう片方が false を要求している。同時には成り立たない。
      return false
    }
  }

  return true
}
