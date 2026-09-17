import { describe, expect, it } from 'vitest'
import { chordToken, parseKeybinding } from './chord'
import { BUILTIN_SHORTCUTS, type BuiltinShortcutDescriptor } from './builtinShortcuts'
import { isAssignableChord, normalizeKey } from './editKeybindings'
import { RESERVED_KEYS, reservedKeyReasons, type ReservedKeyReason } from './reservedKeys'
import type { WhenClause } from './when'

/**
 * 組み込みの一覧（S2。builtinShortcuts.ts）と予約キー（S5。reservedKeys.ts）が
 * 食い違わないこと（S1〜S6 統合）。
 *
 * 2つの表は持つものが違う ── 組み込みは「一覧に何を見せるか」（表示名・群・効く場所）、
 * 予約キーは「割り当てたら何と重なるか」（理由・条件）── ので、1つの表から
 * 作ることはしていない。その代わり、次の2方向をここで確かめる。
 *
 *   1. 組み込みとして見せている打鍵を command に割り当てようとしたら、
 *      **その打鍵が効く場所で必ず警告が出る**（一覧で「変更不可」と見せながら
 *      黙って割り当てさせない）
 *   2. 組み込みの操作に由来する予約（文字の編集・検索・端末）は、
 *      **組み込みの一覧にもその打鍵が並んでいる**（警告の理由が一覧のどこにも見当たらない、を作らない）
 */

/** 組み込みの行が効く場所を、予約キーと同じ `when` で表す。 */
function builtinWhen(descriptor: BuiltinShortcutDescriptor): readonly WhenClause[] {
  if (descriptor.group === 'terminal') {
    return ['terminalFocused']
  }

  return descriptor.scope === 'editor' ? ['editorFocused'] : []
}

function token(key: string): string {
  const chord = parseKeybinding(key)

  if (chord === null) {
    throw new Error(`unreadable key: ${key}`)
  }

  return chordToken(chord)
}

/** 組み込みの操作に由来する予約（一覧にも並ぶべきもの）と、その群。 */
const BUILTIN_BACKED_REASONS: Readonly<Partial<Record<ReservedKeyReason, 'editing' | 'terminal'>>> =
  {
    editorFind: 'editing',
    terminalClipboard: 'terminal',
    terminalSubmit: 'terminal'
  }

describe('組み込みの一覧 → 予約キー', () => {
  const assignable = BUILTIN_SHORTCUTS.flatMap((descriptor) =>
    descriptor.keys
      .filter((key) => {
        const chord = parseKeybinding(key)
        return chord !== null && isAssignableChord(chord)
      })
      .map((key) => ({ descriptor, key }))
  )

  it('割り当てられる組み込みの打鍵がある（この確認が空回りしていない）', () => {
    expect(assignable.length).toBeGreaterThan(10)
  })

  it.each(assignable.map(({ descriptor, key }) => [descriptor.id, key, descriptor] as const))(
    '%s の %s は、効く場所で予約キーの警告が出る',
    (_id, key, descriptor) => {
      expect(reservedKeyReasons(key, builtinWhen(descriptor))).not.toEqual([])
    }
  )

  /*
    割り当てられない打鍵（Enter / Shift+Enter / Shift+Insert）は、記録の段階で断られる
    （editKeybindings.ts の isAssignableChord）ので警告の対象にならない。
  */
  it('割り当てられない組み込みの打鍵は、予約キーに載せない', () => {
    const unassignable = BUILTIN_SHORTCUTS.flatMap((descriptor) => descriptor.keys).filter(
      (key) => {
        const chord = parseKeybinding(key)
        return chord !== null && !isAssignableChord(chord)
      }
    )

    expect(unassignable.map(token).sort()).toEqual(['enter', 'shift+enter', 'shift+insert'])

    for (const key of unassignable) {
      expect(
        RESERVED_KEYS.some((entry) => normalizeKey(entry.key) === token(key)),
        key
      ).toBe(false)
    }
  })
})

describe('予約キー → 組み込みの一覧', () => {
  it.each(Object.entries(BUILTIN_BACKED_REASONS))(
    '%s の打鍵は、組み込みの %s の群に並ぶ',
    (reason, group) => {
      const listed = new Set(
        BUILTIN_SHORTCUTS.filter((descriptor) => descriptor.group === group).flatMap((descriptor) =>
          descriptor.keys.map(token)
        )
      )

      for (const entry of RESERVED_KEYS.filter((candidate) => candidate.reason === reason)) {
        expect(listed.has(token(entry.key)), `${reason} ${entry.key}`).toBe(true)
      }
    }
  )

  /* 文字の編集は、編集の群に全部並ぶ（端末の Ctrl+C / Ctrl+V は別の意味で端末の群にも並ぶ）。 */
  it('textEditing の打鍵は、組み込みの編集の群に並ぶ', () => {
    const editing = new Set(
      BUILTIN_SHORTCUTS.filter((descriptor) => descriptor.group === 'editing').flatMap(
        (descriptor) => descriptor.keys.map(token)
      )
    )

    for (const entry of RESERVED_KEYS.filter((candidate) => candidate.reason === 'textEditing')) {
      expect(editing.has(token(entry.key)), entry.key).toBe(true)
    }
  })

  /*
    端末の文字の大きさは、一覧では代表の表記（Ctrl++ / Ctrl+= / Ctrl+- / Ctrl+0）だけを見せ、
    予約キーは日本語配列の物理キー（Ctrl+Shift+; など）まで持つ。一覧の側が予約に含まれることだけを見る。
  */
  it('端末の文字の大きさは、一覧の打鍵がすべて予約に含まれる', () => {
    const reserved = new Set(
      RESERVED_KEYS.filter((entry) => entry.reason === 'terminalFontSize').map((entry) =>
        token(entry.key)
      )
    )
    const listed = BUILTIN_SHORTCUTS.filter((descriptor) =>
      descriptor.id.startsWith('terminal.fontSize')
    ).flatMap((descriptor) => descriptor.keys.map(token))

    expect(listed.length).toBeGreaterThan(0)
    for (const key of listed) {
      expect(reserved.has(key), key).toBe(true)
    }
  })
})
