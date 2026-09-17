import { KEYBINDING_REMOVAL_PREFIX, type StoredKeybindingEntry } from '@shared/keybindings'
import { isCommandId, type CommandId } from '../commands/commandIds'
import { parseKeybinding } from './chord'
import { DEFAULT_KEYBINDINGS } from './defaults'
import type { KeybindingRule } from './resolve'
import type { WhenClause } from './when'

/**
 * `keybindings.json` の行を、割り当ての rule へ読み替える（Shortcuts S3）。
 *
 * React にも DOM にも依存しない純粋な層。Main は形だけを確かめて渡してくる
 * （main/store/keybindingsDocument.ts）ので、**意味を確かめる関門はここ1つ**になる。
 *
 *   - command 名は `isCommandId` を必ず通す（commands/commandIds.ts の冒頭）
 *   - 打鍵は `parseKeybinding` で読めるものだけ
 *
 * 読めない行は捨てずに `invalid` として理由付きで返す。Settings の一覧で
 * 「書いたのに効かない」を見せるため（Shortcuts S5）。
 *
 * ## 条件は書かせず、既定から引き継ぐ
 *
 * ユーザーの行に `when` は無い。その command の**既定の割り当ての条件**を
 * そのまま付ける。
 *
 *   - F2 を別の打鍵へ移しても `editorFocused` が残る ── 残らないと、
 *     Files のツリーで押したときにファイル名とシンボル名の変更が同時に始まる
 *     （defaults.ts）
 *   - 端末を触っている最中に走らせない `'!terminalFocused'` も残る
 *
 * 既定の割り当てを持たない command（`git.push` など）は条件無しになる。
 *
 * `when` が手で書かれていた行は**読めない行**として扱う。条件を無視して読むと、
 * 条件付きのつもりの割り当てがどこでも効く ── when.ts の fail-closed と同じ考え方。
 */

/** 読めなかった理由。 */
export type UserKeybindingProblem = 'unknownCommand' | 'invalidKey' | 'whenNotSupported'

export interface InvalidUserKeybinding {
  /** ファイルの中で何番目の行か（0 始まり。Main が形で落とした行は数えていない）。 */
  readonly index: number
  readonly entry: StoredKeybindingEntry
  readonly problem: UserKeybindingProblem
}

export interface UserKeybindings {
  /** 効く rule（ファイルの並び順のまま）。 */
  readonly rules: readonly KeybindingRule[]
  readonly invalid: readonly InvalidUserKeybinding[]
}

export function readUserKeybindings(
  stored: readonly StoredKeybindingEntry[],
  defaults: readonly KeybindingRule[] = DEFAULT_KEYBINDINGS
): UserKeybindings {
  const rules: KeybindingRule[] = []
  const invalid: InvalidUserKeybinding[] = []

  stored.forEach((entry, index) => {
    const remove = entry.command.startsWith(KEYBINDING_REMOVAL_PREFIX)
    const commandId = remove ? entry.command.slice(KEYBINDING_REMOVAL_PREFIX.length) : entry.command

    if (!isCommandId(commandId)) {
      invalid.push({ index, entry, problem: 'unknownCommand' })
      return
    }

    if (parseKeybinding(entry.key) === null) {
      invalid.push({ index, entry, problem: 'invalidKey' })
      return
    }

    if (entry.when !== undefined) {
      invalid.push({ index, entry, problem: 'whenNotSupported' })
      return
    }

    if (remove) {
      rules.push({ commandId, key: entry.key, source: 'user', remove: true })
      return
    }

    const when = inheritedWhen(commandId, defaults)

    rules.push(
      when === undefined
        ? { commandId, key: entry.key, source: 'user' }
        : { commandId, key: entry.key, when, source: 'user' }
    )
  })

  return { rules, invalid }
}

/**
 * その command の既定の条件。
 *
 * 既定の割り当てが複数あり条件が食い違う場合は、先頭のものを使う
 * （今の defaults.ts には1つの command に1つの割り当てしか無い）。
 */
function inheritedWhen(
  commandId: CommandId,
  defaults: readonly KeybindingRule[]
): readonly WhenClause[] | undefined {
  return defaults.find((rule) => rule.commandId === commandId && rule.remove !== true)?.when
}
