import { describe, expect, it } from 'vitest'
import { COMMAND_IDS, isCommandId, type CommandId } from './commandIds'
import { getCommandDescriptor, listCommands } from './registry'
import { commandTitle, type CommandDescriptor } from './types'

/**
 * Command Registry（Session 4-7A）。
 *
 * 型で防げているものは、ここでは確かめない（`Record<CommandId, …>` の
 * 登録漏れなど）。**実数でしか分からないもの**だけを見る。
 */

describe('COMMAND_IDS', () => {
  it('同じ id を2つ持たない', () => {
    expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length)
  })

  it('id はすべて `<領域>.<動詞>` の形をしている', () => {
    for (const id of COMMAND_IDS) {
      expect(id).toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/)
    }
  })
})

describe('isCommandId', () => {
  it('既知の id を通す', () => {
    for (const id of COMMAND_IDS) {
      expect(isCommandId(id)).toBe(true)
    }
  })

  it('知らない文字列・文字列でない値を通さない', () => {
    // 将来 keybindings.json から来る値を想定した関門（commandIds.ts の冒頭）。
    expect(isCommandId('editor.explode')).toBe(false)
    expect(isCommandId('')).toBe(false)
    expect(isCommandId(null)).toBe(false)
    expect(isCommandId(42)).toBe(false)
    expect(isCommandId({ id: 'editor.save' })).toBe(false)
  })
})

describe('listCommands', () => {
  it('登録されている command をすべて返す', () => {
    expect(listCommands()).toHaveLength(COMMAND_IDS.length)
  })

  it('COMMAND_IDS の並びで返す（表の書き方に依存しない）', () => {
    expect(listCommands().map((command) => command.id)).toEqual([...COMMAND_IDS])
  })

  it('descriptor の id が、引くときの id と一致する', () => {
    for (const id of COMMAND_IDS) {
      expect(getCommandDescriptor(id).id).toBe(id)
    }
  })

  it('category が id の先頭の語と一致する', () => {
    // 片方だけ足すと落ちる（commands/types.ts の CommandCategory）。
    for (const command of listCommands()) {
      expect(command.category).toBe(command.id.split('.')[0])
    }
  })

  it('title が空でない', () => {
    for (const command of listCommands()) {
      expect(command.title.length).toBeGreaterThan(0)
    }
  })
})

describe('commandTitle', () => {
  /*
    Session 4-7A では、どの command も titleKey を持たない
    （i18n/locales/en.ts・ja.ts を変えないため。types.ts の titleKey）。
    4-7B で足したときに接続が効くことを、ここで先に固定しておく。
  */
  it('Session 4-7A では、どの command も titleKey を持たない', () => {
    for (const command of listCommands()) {
      expect(command.titleKey).toBeUndefined()
    }
  })

  it('titleKey が無ければ title を返す（翻訳を呼ばない）', () => {
    const descriptor = getCommandDescriptor('editor.save')

    expect(
      commandTitle(descriptor, () => {
        throw new Error('titleKey が無いのに翻訳が呼ばれた')
      })
    ).toBe(descriptor.title)
  })

  it('titleKey があれば翻訳を通す（Session 4-7B の接続）', () => {
    const descriptor = {
      id: 'settings.open' satisfies CommandId,
      category: 'settings',
      title: 'Open Settings',
      // 実在する翻訳キーなら何でもよい（4-7B で command ごとの key に差し替わる）。
      titleKey: 'settings.title'
    } as const satisfies CommandDescriptor

    expect(commandTitle(descriptor, (key) => `translated:${key}`)).toBe('translated:settings.title')
  })
})
