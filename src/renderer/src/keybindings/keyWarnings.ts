import type { StoredKeybindingEntry } from '@shared/keybindings'
import type { CommandId } from '../commands/commandIds'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { commandKeys, normalizeKey, replaceKey, withCommandKeys } from './editKeybindings'
import { reservedKeyReasons, type ReservedKeyReason } from './reservedKeys'
import {
  resolveKeybindings,
  sameWhen,
  type KeybindingRule,
  type ResolvedKeybinding
} from './resolve'
import { readUserKeybindings } from './userKeybindings'
import { whenOverlaps } from './when'

/**
 * 打鍵の警告（Shortcuts S5）。
 *
 * React にも DOM にも依存しない純粋な層。Settings の一覧の行と、記録中の打鍵の
 * 両方が同じ判定を使う。
 *
 * ## 「意図した割り当て」と「効いている割り当て」を分けて見る
 *
 * resolve.ts は同じ打鍵 × 同じ条件を後勝ちで**1つに畳む**。畳まれた側は表から消え、
 * S4 の一覧では「奪われた command が未割り当てに見える」ことがあった
 * （S4 記録の注意）。そこで2つの表を突き合わせる。
 *
 * ```
 * intended  … command ごとに自分の rule だけを畳んだもの（editKeybindings.ts の commandKeys と同じ考え方）
 * effective … 全体を畳んだもの（KeybindingProvider が打鍵に使う表）
 * ```
 *
 * intended にあって effective に無い割り当ては「**書いてあるが、同じ条件で別の
 * command が取っているため動かない**」。一覧はそれも行として出し、警告を付ける。
 *
 * ## 重なっているとき、どちらが動くか
 *
 * 条件が違っても同時に成り立ちうる（`whenOverlaps`）なら、両方が効く場面では
 * **effective の後ろにある方**が動く（dispatch.ts の後勝ち）。これを `winner` として返す。
 */

export interface KeyConflict {
  /** 同じ打鍵を、同時に成り立ちうる条件で持っている他の command。 */
  readonly commandIds: readonly CommandId[]
  /** 両方が効く場面で実際に動く command（自分のこともある）。 */
  readonly winner: CommandId
  /** 同じ条件で他の command に取られていて、この割り当ては一度も動かない。 */
  readonly overridden: boolean
}

export interface KeyWarnings {
  readonly conflict: KeyConflict | null
  readonly reserved: readonly ReservedKeyReason[]
}

const NO_WARNINGS: KeyWarnings = { conflict: null, reserved: [] }

/**
 * command ごとに自分の rule だけを畳んだ割り当て（並びは command が最初に現れた順）。
 *
 * 別の command に後勝ちで奪われた打鍵も、奪われた側の割り当てとして残る。
 */
export function intendedKeybindings(
  rules: readonly KeybindingRule[]
): readonly ResolvedKeybinding[] {
  const byCommand = new Map<CommandId, KeybindingRule[]>()

  for (const rule of rules) {
    const own = byCommand.get(rule.commandId)

    if (own === undefined) {
      byCommand.set(rule.commandId, [rule])
    } else {
      own.push(rule)
    }
  }

  return [...byCommand.values()].flatMap((own) => resolveKeybindings(own).entries)
}

/**
 * その command のその打鍵に付く警告。
 *
 * `intended` に該当する割り当てが無ければ警告なし。
 */
export function keyWarnings(
  commandId: CommandId,
  token: string,
  intended: readonly ResolvedKeybinding[],
  effective: readonly ResolvedKeybinding[]
): KeyWarnings {
  const mine = intended.find((entry) => entry.commandId === commandId && entry.token === token)

  if (mine === undefined) {
    return NO_WARNINGS
  }

  return {
    conflict: findConflict(mine, intended, effective),
    reserved: reservedKeyReasons(token, mine.when)
  }
}

function findConflict(
  mine: ResolvedKeybinding,
  intended: readonly ResolvedKeybinding[],
  effective: readonly ResolvedKeybinding[]
): KeyConflict | null {
  const others = [
    ...new Set(
      intended
        .filter(
          (entry) =>
            entry.token === mine.token &&
            entry.commandId !== mine.commandId &&
            whenOverlaps(mine.when, entry.when)
        )
        .map((entry) => entry.commandId)
    )
  ]

  if (others.length === 0) {
    return null
  }

  const index = effective.findIndex(
    (entry) =>
      entry.commandId === mine.commandId &&
      entry.token === mine.token &&
      sameWhen(entry.when, mine.when)
  )

  if (index === -1) {
    const taker = effective.find(
      (entry) => entry.token === mine.token && sameWhen(entry.when, mine.when)
    )

    return { commandIds: others, winner: taker?.commandId ?? others[0], overridden: true }
  }

  let winner = mine.commandId

  for (const entry of effective.slice(index + 1)) {
    if (
      entry.token === mine.token &&
      entry.commandId !== mine.commandId &&
      whenOverlaps(mine.when, entry.when)
    ) {
      winner = entry.commandId
    }
  }

  return { commandIds: others, winner, overridden: false }
}

/**
 * 記録中の打鍵を確定したら、どんな警告が付くか。
 *
 * 画面と同じ書き直し（`withCommandKeys`）で保存後のファイルを作り、それを
 * 読み直して判定する ── 「確定すると何が起きるか」を、実際に保存する経路と
 * 別の推測で出さないため。
 *
 * `from` は置き換える打鍵（null なら足す）。`key` は記録した打鍵。
 */
export function previewKeyWarnings(
  stored: readonly StoredKeybindingEntry[],
  commandId: CommandId,
  from: string | null,
  key: string,
  defaults: readonly KeybindingRule[] = DEFAULT_KEYBINDINGS
): KeyWarnings {
  const token = normalizeKey(key)

  if (token === null) {
    return NO_WARNINGS
  }

  const current = commandKeys(commandId, readUserKeybindings(stored, defaults).rules, defaults)
  const next = withCommandKeys(stored, commandId, replaceKey(current, from, token), defaults)
  const rules = [...defaults, ...readUserKeybindings(next, defaults).rules]

  return keyWarnings(
    commandId,
    token,
    intendedKeybindings(rules),
    resolveKeybindings(rules).entries
  )
}
