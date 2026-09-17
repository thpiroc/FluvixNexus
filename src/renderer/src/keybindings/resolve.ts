import type { CommandId } from '../commands/commandIds'
import { chordToken, parseKeybinding, type KeyChord } from './chord'
import { whenOverlaps, type WhenClause } from './when'

/**
 * 割り当ての表と、その畳み方（Session 4-7A）。
 *
 * React にも DOM にも依存しない純粋な層。
 *
 * ## Default / User / Workspace への拡張を、型を変えずに受ける
 *
 * v1 が作る rule は `defaults.ts` の `source: 'default'` だけ。それでも
 * `KeybindingSource` を最初から3つ持たせ、`resolveKeybindings` が
 * **順序付きの配列を1本受け取って後勝ちで畳む**形にしてあるのは、
 * 将来の追加を「連結の順番」だけで済ませるため。
 *
 * ```ts
 * // v1
 * resolveKeybindings(DEFAULT_KEYBINDINGS)
 * // Shortcuts S3（keybindings.json を読むようになった。KeybindingProvider.tsx）
 * resolveKeybindings([...DEFAULT_KEYBINDINGS, ...userRules])
 * ```
 *
 * 型も、この関数も、呼ばれる側も変わらなかった（S3 で足したのは解除の rule だけ）。逆に v1 で `source` を
 * 持たせずに作ると、後から入れるときに**保存形式と解決順の両方**が変わる。
 *
 * ## 後勝ちにする単位
 *
 * 同じ打鍵 × 同じ条件 の組が2つあれば、**後に来た方だけが残る**。
 * VS Code と同じで、User の割り当てが Default を「上書きする」のはこの規則
 * から自然に出る（後ろに置くから）。
 *
 * 条件が違えば別の rule として両方残る ── `ctrl+j` が
 * 「Terminal に focus が無いとき」と「あるとき」で違う command を指すのは、
 * 競合ではなく使い分けにあたる。
 *
 * ## 割り当ての解除（Shortcuts S3）
 *
 * `remove: true` の rule は割り当てを足さず、**それより前に並んでいる**
 * 同じ command × 同じ打鍵の割り当てを外す（`keybindings.json` の
 * `"-editor.save"`。VS Code と同じ）。
 *
 * 条件は見ない。ユーザーの割り当ては条件を書かず既定から引き継ぐ
 * （userKeybindings.ts）ので、「この操作からこの打鍵を外す」で意味が足りる。
 * 「前にあるものだけ」にしてあるのは、後勝ちの規則と揃えるため ──
 * 解除の後ろに同じ割り当てを書き直せば、それが効く。
 */

/** その割り当てがどこから来たか。 */
export type KeybindingSource = 'default' | 'user' | 'workspace'

/**
 * 割り当て1件。
 *
 * ディスクの形（`StoredKeybindingEntry`）とは別の型で、読み替えは
 * userKeybindings.ts が受け持つ。
 */
export interface KeybindingRule {
  readonly commandId: CommandId
  /** `'ctrl+shift+s'`。読めない形は解決の時点で落ちる。 */
  readonly key: string
  readonly when?: readonly WhenClause[]
  readonly source: KeybindingSource
  /** true なら割り当てを足さず、前にある同じ command × 同じ打鍵を外す。 */
  readonly remove?: boolean
}

/** 解決済みの1件（打鍵が正規化され、表を引く鍵が付いたもの）。 */
export interface ResolvedKeybinding {
  readonly commandId: CommandId
  readonly chord: KeyChord
  /** `chordToken` の結果。表を引く鍵。 */
  readonly token: string
  readonly when: readonly WhenClause[]
  readonly source: KeybindingSource
}

export interface KeybindingResolution {
  /** 効く割り当て（前から順に、後勝ちで畳んだ結果）。 */
  readonly entries: readonly ResolvedKeybinding[]
  /**
   * 打鍵として読めなかった rule。
   *
   * 捨てずに返すのは、**「書いたのに効かない」を利用者へ見せられる**ようにするため
   * （Settings の一覧に出す想定。`keybindings.json` の行は userKeybindings.ts が
   * 先に打鍵を確かめるので、ここへ来るのは主にテストで作った rule）。
   */
  readonly invalid: readonly KeybindingRule[]
}

/**
 * rule の並びを、効く割り当ての表へ畳む。
 *
 * 引数の順序がそのまま優先順（後にあるものが勝つ）。
 */
export function resolveKeybindings(rules: readonly KeybindingRule[]): KeybindingResolution {
  const entries: ResolvedKeybinding[] = []
  const invalid: KeybindingRule[] = []

  for (const rule of rules) {
    const chord = parseKeybinding(rule.key)

    if (chord === null) {
      invalid.push(rule)
      continue
    }

    const token = chordToken(chord)

    if (rule.remove === true) {
      // 前にある同じ command × 同じ打鍵を外す（このファイルの冒頭）。
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index].commandId === rule.commandId && entries[index].token === token) {
          entries.splice(index, 1)
        }
      }
      continue
    }

    const when = rule.when ?? []

    /*
      同じ打鍵 × 同じ条件 が既にあれば置き換える（後勝ち）。
      条件の一致は「並びの見た目」ではなく中身で見る ── `['a','b']` と
      `['b','a']` は同じ意味なので、順序が違うだけで別物になっては困る。
    */
    const existing = entries.findIndex(
      (entry) => entry.token === token && sameWhen(entry.when, when)
    )

    const resolved: ResolvedKeybinding = {
      commandId: rule.commandId,
      chord,
      token,
      when,
      source: rule.source
    }

    if (existing === -1) {
      entries.push(resolved)
    } else {
      entries[existing] = resolved
    }
  }

  return { entries, invalid }
}

function sameWhen(a: readonly WhenClause[], b: readonly WhenClause[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  const left = [...a].sort()
  const right = [...b].sort()

  return left.every((clause, index) => clause === right[index])
}

/** 同じ打鍵に、同時に成り立ちうる条件で複数の command が付いている状態。 */
export interface KeybindingConflict {
  readonly token: string
  readonly commandIds: readonly CommandId[]
}

/**
 * 競合を洗い出す。
 *
 * 使うのは Session 4-7B 以降の Settings の「競合表示」と、
 * `defaults.ts` が競合を含んでいないことを確かめるテスト。
 *
 * 「同じ打鍵」だけでは競合にならない ── 条件が両立しなければ、同時に
 * 効くことはない（`whenOverlaps`）。同じ command どうしも競合ではない
 * （同じ操作に複数の割り当てがあるのは普通のこと）。
 */
export function findKeybindingConflicts(
  entries: readonly ResolvedKeybinding[]
): readonly KeybindingConflict[] {
  const conflicts = new Map<string, Set<CommandId>>()

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i]
      const b = entries[j]

      if (a.token !== b.token || a.commandId === b.commandId) {
        continue
      }

      if (!whenOverlaps(a.when, b.when)) {
        continue
      }

      const found = conflicts.get(a.token) ?? new Set<CommandId>()
      found.add(a.commandId)
      found.add(b.commandId)
      conflicts.set(a.token, found)
    }
  }

  return [...conflicts.entries()].map(([token, commandIds]) => ({
    token,
    commandIds: [...commandIds]
  }))
}
