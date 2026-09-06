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

describe('Session 4-7B で足した contribution（git / files）', () => {
  /*
    「登録されているか」を実数で押さえる。所有者が誰かは jsdom 側
    （commands/contribution.dom.test.ts）で、ここは表の側だけを見る。
  */
  const ids = new Set<string>(COMMAND_IDS)

  it('Git の7件が表に載っている', () => {
    for (const id of [
      'git.refresh',
      'git.commit',
      'git.push',
      'git.pull',
      'git.fetch',
      'git.openHistory',
      'git.stashPush'
    ]) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it('Files の3件が表に載っている', () => {
    for (const id of ['files.refresh', 'files.search.byName', 'files.search.byContent']) {
      expect(ids.has(id), id).toBe(true)
    }
  })

  it('category は id の先頭語のまま（git / files が CommandCategory に居る）', () => {
    // 上の listCommands の同名テストと重なるが、あちらは全体、ここは新しい2つ。
    for (const command of listCommands()) {
      if (command.id.startsWith('git.')) {
        expect(command.category).toBe('git')
      }

      if (command.id.startsWith('files.')) {
        expect(command.category).toBe('files')
      }
    }
  })

  it('3段の id（files.search.*）も id の形を満たす', () => {
    // commandIds.ts の「`<領域>.<動詞>` の2段（対象が続くものだけ3段）」。
    expect('files.search.byName').toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/)
    expect('files.search.byContent').toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/)
  })
})

describe('commandTitle', () => {
  /*
    Session 4-7C で 21件すべてが titleKey を持つようになった。

    4-7A / 4-7B が見送っていたのは**読む相手が居なかった**ためで、
    Settings の Keyboard Shortcuts 一覧ができたことでその理由は消えている。
    予告どおり全件を一度に入れてある ── 一部だけ埋まっていると
    `commandTitle()` が「翻訳されるものとされないもの」の混ざった一覧を返す。

    key の形と en / ja の対応は commandLocalization.test.ts が受け持つ。
    ここでは `commandTitle()` の分岐だけを見る。
  */
  it('21件すべてが titleKey を持つ', () => {
    for (const command of listCommands()) {
      expect(command.titleKey, command.id).toBeDefined()
    }
  })

  /*
    分岐そのものは残してある（`titleKey` は型の上では任意のまま）。
    表の21件はすべて titleKey を持つので、ここは組み立てた descriptor で見る
    ── 必須にしてこの道を消さない理由は commands/types.ts にある。
  */
  it('titleKey が無ければ title を返す（翻訳を呼ばない）', () => {
    const descriptor = {
      id: 'editor.save' satisfies CommandId,
      category: 'editor',
      title: 'Save'
    } as const satisfies CommandDescriptor

    expect(
      commandTitle(descriptor, () => {
        throw new Error('titleKey が無いのに翻訳が呼ばれた')
      })
    ).toBe('Save')
  })

  it('titleKey があれば翻訳を通す（一覧 UI を作るときの接続）', () => {
    const descriptor = {
      id: 'settings.open' satisfies CommandId,
      category: 'settings',
      title: 'Open Settings',
      // 実在する翻訳キーなら何でもよい（後で command ごとの key に差し替わる）。
      titleKey: 'settings.title'
    } as const satisfies CommandDescriptor

    expect(commandTitle(descriptor, (key) => `translated:${key}`)).toBe('translated:settings.title')
  })
})
