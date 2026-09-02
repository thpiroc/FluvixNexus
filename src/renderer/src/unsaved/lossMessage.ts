import type { LossAction, LossItem, LossKind } from './types'

/**
 * 確認の文面を決める（React にも DOM にも依存しない・テスト対象）。
 *
 * ## なぜ器から切り出すのか
 *
 * Session 3-7-4 で、この確認が扱うものが2種類になった（未保存の変更と、
 * 実行中のターミナル）。**同じ器で違うことを言う**必要が出たため、
 * 「何をしようとしていて、何が失われ、どの道が選べるか」の組み立てを
 * ダイアログの JSX の中に散らさず、1つの関数にまとめてある。
 *
 * 文面を間違えると確認そのものが逆に働く ── 実行中のターミナルしか無いのに
 * 「保存されていない変更があります」と出れば、利用者は身に覚えのない警告として
 * 読み飛ばすことになる。だからここはテストで固定する対象にしてある。
 *
 * ## 「保存」を出すかどうかも文面と同じ判断から出す
 *
 * 押せるのに救えない選択肢を出さない（types.ts の `unsavable`）。
 * 実行中のターミナルしか無ければ保存は並ばず、選べるのは
 * 「終了する」か「キャンセル」の2つになる。
 */

/** ダイアログに出すもの一式。 */
export interface LossPrompt {
  readonly title: string
  readonly body: string
  /** 失われることを承知で続ける側のボタン。 */
  readonly discardLabel: string
  /** 保存して続ける道があるか（1件でも救えるものがあるか）。 */
  readonly canSave: boolean
}

/** その操作を言い表す言葉（「〜と、…」の前半）。 */
function describeAction(action: LossAction): string {
  switch (action) {
    case 'close-workspace':
      return 'Workspace を閉じる'

    case 'switch-workspace':
      return '別の Workspace へ切り替える'

    case 'close-window':
      return 'Fluvix Nexus を終了する'
  }
}

/**
 * 何が起きるか（「〜と、…」の後半）。
 *
 * 種別ごとに言い方が違う。未保存の変更は**失われる**もので、
 * 実行中のターミナルは**終了する**もの ── 後者を「失われます」と書くと、
 * 何が消えるのかがぼやける。
 */
function describeConsequence(kinds: ReadonlySet<LossKind>): string {
  const files = kinds.has('unsaved-file')
  const terminals = kinds.has('running-terminal')

  if (files && terminals) {
    return '次のファイルの未保存の変更が失われ、実行中のターミナルが終了します'
  }

  return files
    ? '次のファイルの未保存の変更が失われます'
    : '次のターミナルで実行中のコマンドが終了します'
}

function describeTitle(kinds: ReadonlySet<LossKind>): string {
  const files = kinds.has('unsaved-file')
  const terminals = kinds.has('running-terminal')

  if (files && terminals) {
    return '保存されていない変更と、実行中のターミナルがあります'
  }

  return files ? '保存されていない変更があります' : '実行中のターミナルがあります'
}

/**
 * 続ける側のボタン。
 *
 * 何を捨てることになるのかをボタン自身に書く。「OK」では、押した後に何が
 * 起きるのかがボタンの外にしか無い（DeleteConfirm.tsx と同じ考え方）。
 */
function describeDiscardLabel(action: LossAction, kinds: ReadonlySet<LossKind>): string {
  if (!kinds.has('running-terminal')) {
    return '保存しない'
  }

  const withFiles = kinds.has('unsaved-file')

  if (action === 'close-window') {
    return withFiles ? '保存せずに終了' : '終了する'
  }

  return withFiles ? '保存せずに続ける' : '続ける'
}

export function describeLossPrompt(action: LossAction, items: readonly LossItem[]): LossPrompt {
  const kinds = new Set(items.map((item) => item.kind))

  return {
    title: describeTitle(kinds),
    body: `${describeAction(action)}と、${describeConsequence(kinds)}。`,
    discardLabel: describeDiscardLabel(action, kinds),
    // 1件でも救えるものがあるときだけ「保存」を出す（types.ts の unsavable）。
    canSave: items.some((item) => !item.unsavable)
  }
}

/**
 * 一覧の1行に添える但し書き。
 *
 * 添えるのは**保存で救えないもの**だけで、理由が種別ごとに違う。
 * 何も添えないもの（ふつうの未保存のファイル）に「保存できます」と書かない ──
 * 普通であることを毎回書くと、書いてある方が目に入らなくなる
 * （TerminalTabs.tsx の describeStatus と同じ判断）。
 */
export function describeLossNote(item: LossItem): string | null {
  if (item.kind === 'running-terminal') {
    return '実行中のコマンドがあります'
  }

  /*
    削除されている場合は、次の一手も添える（Session 4-2）。

    この確認から救い出すことはできない ── ここの「保存」が呼ぶのは
    元の位置へ書き戻す経路（EditorProvider.tsx の saveAll）で、
    書き戻す先が無いのがこの状態そのものだから。
    救えるのは Editor の帯（EditorConflictBar.tsx）にある「別名で保存」だけなので、
    **押せない理由と一緒に、押せる場所を書く。**
  */
  return item.unsavable
    ? 'ディスク上から削除されています（Editor の「別名で保存」で救い出せます）'
    : null
}
