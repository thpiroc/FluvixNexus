import { describe, expect, it } from 'vitest'
import { LANGUAGE_IDS } from '@shared/language'
import { createTranslator } from '../i18n/messages'
import { COMMAND_CATEGORY_ORDER, getCommandCategoryTitle } from './commandCategoryLabels'
import { COMMAND_IDS } from './commandIds'
import { listCommands } from './registry'
import { commandTitle, type CommandCategory } from './types'

/**
 * Command の表示名の翻訳（Session 4-7C）。
 *
 * en / ja の**キーの一致**そのものは2段で守られている。
 *
 *   1. `locales/ja.ts` の `satisfies TranslationMessages` ── 欠落も余剰も型エラー
 *   2. `i18n/messages.test.ts` ── 平らにした key の集合が一致すること
 *
 * したがってここで見るのは、その2段では拾えないものになる。
 *
 *   - **全件が `titleKey` を持つ**（型の上では任意なので、実数で見る）
 *   - key が `command.<CommandId>` に1対1で対応すること
 *   - **両言語で実際に解決でき、キーがそのまま出ていないこと**
 *
 * 3つめが要点にあたる。`createTranslator` は知らない key に対して
 * **key 自身を返す**（messages.ts）── 型が通っていても、辞書の入れ子を
 * 1段間違えれば画面に `command.git.push` と出る。それは型では拾えない。
 */

const CATEGORY_PREFIXES: Readonly<Record<CommandCategory, string>> = {
  workspace: 'workspace.',
  editor: 'editor.',
  view: 'view.',
  settings: 'settings.',
  debug: 'debug.',
  git: 'git.',
  files: 'files.'
}

describe('command の titleKey', () => {
  it('全件が titleKey を持つ', () => {
    const withKey = listCommands().filter((command) => command.titleKey !== undefined)

    expect(withKey).toHaveLength(COMMAND_IDS.length)
    /*
      実数も押さえる（表に足したのに翻訳を忘れた、を `COMMAND_IDS.length` との
      比較だけに任せない）。Session 6-16 の Debug Keybinding 用 command を
      加えて 40件。
    */
    expect(COMMAND_IDS).toHaveLength(40)
  })

  /*
    機械的に決まる形にしてある理由は registry.ts にある ── この1本で
    「足し忘れ」も「別の command の key を貼った」も同時に落ちる。
  */
  it('key が `command.<CommandId>` に1対1で対応する', () => {
    for (const command of listCommands()) {
      expect(command.titleKey, command.id).toBe(`command.${command.id}`)
    }
  })

  it('key が重複しない', () => {
    const keys = listCommands().map((command) => command.titleKey)

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('command の表示名（en / ja parity）', () => {
  for (const language of LANGUAGE_IDS) {
    describe(language, () => {
      const t = createTranslator(language)

      it('全件が翻訳を持ち、キーがそのまま出ない', () => {
        for (const command of listCommands()) {
          const title = commandTitle(command, t)

          expect(title, command.id).not.toBe(command.titleKey)
          expect(title.length, command.id).toBeGreaterThan(0)
          expect(title.trim(), command.id).toBe(title)
        }
      })

      it('表示名が重複しない（一覧で見分けが付く）', () => {
        const titles = listCommands().map((command) => commandTitle(command, t))

        expect(new Set(titles).size).toBe(titles.length)
      })

      /*
        `'Git: Commit'` のようにカテゴリを名前へ埋め込まない ── どのカテゴリの
        ものかは一覧の見出しが持つ（settings/KeyboardShortcutsView.tsx）。
      */
      it('表示名にカテゴリを埋め込んでいない', () => {
        for (const command of listCommands()) {
          const categoryTitle = getCommandCategoryTitle(command.category, t)

          expect(commandTitle(command, t), command.id).not.toContain(`${categoryTitle}:`)
        }
      })
    })
  }

  it('ja と en で違う文字列が出る（辞書が片方を向いていない）', () => {
    const ja = createTranslator('ja')
    const en = createTranslator('en')

    /* Commit / Push のように語として同じものはあるので、全件一致でなければよい。 */
    const differing = listCommands().filter(
      (command) => commandTitle(command, ja) !== commandTitle(command, en)
    )

    expect(differing.length).toBeGreaterThan(0)
  })
})

describe('カテゴリの表示名', () => {
  it('CommandCategory をすべて並べる（過不足なし）', () => {
    const used = new Set(listCommands().map((command) => command.category))

    expect([...COMMAND_CATEGORY_ORDER].sort()).toEqual([...used].sort())
  })

  it('並びが重複しない', () => {
    expect(new Set(COMMAND_CATEGORY_ORDER).size).toBe(COMMAND_CATEGORY_ORDER.length)
  })

  /*
    `COMMAND_CATEGORY_ORDER` を `COMMAND_IDS` の並びに依存させていないこと
    （commandCategoryLabels.ts）。それでも今は一致しているはずで、
    ずれた場合は「一覧の見出しの順」と「表を書いた順」が食い違う。
  */
  it('COMMAND_IDS に現れる順と一致する', () => {
    const seen: CommandCategory[] = []

    for (const command of listCommands()) {
      if (!seen.includes(command.category)) {
        seen.push(command.category)
      }
    }

    expect(seen).toEqual([...COMMAND_CATEGORY_ORDER])
  })

  it('category が command id の先頭の語と対応する', () => {
    for (const command of listCommands()) {
      expect(command.id.startsWith(CATEGORY_PREFIXES[command.category]), command.id).toBe(true)
    }
  })

  for (const language of LANGUAGE_IDS) {
    it(`${language} で6つとも翻訳を持ち、キーがそのまま出ない`, () => {
      const t = createTranslator(language)
      const titles = COMMAND_CATEGORY_ORDER.map((category) => getCommandCategoryTitle(category, t))

      for (const [index, title] of titles.entries()) {
        expect(title, COMMAND_CATEGORY_ORDER[index]).not.toContain('settings.keyboard.categories.')
        expect(title.length, COMMAND_CATEGORY_ORDER[index]).toBeGreaterThan(0)
      }

      expect(new Set(titles).size).toBe(titles.length)
    })
  }
})

describe('UI ラベル（Keyboard Shortcuts の画面）', () => {
  const LABEL_KEYS = [
    'settings.categories.keyboard.title',
    'settings.categories.keyboard.description',
    'settings.keyboard.tableLabel',
    'settings.keyboard.searchLabel',
    'settings.keyboard.searchPlaceholder',
    'settings.keyboard.searchClear',
    'settings.keyboard.viewOnlyNote',
    'settings.keyboard.builtinNote',
    'settings.keyboard.builtin.badge',
    'settings.keyboard.builtin.groups.editing',
    'settings.keyboard.builtin.groups.terminal',
    'settings.keyboard.builtin.scopes.editorAndInputs',
    'settings.keyboard.builtin.scopes.editor',
    'settings.keyboard.columns.command',
    'settings.keyboard.columns.shortcut',
    'settings.keyboard.unassigned',
    /*
      Source は v1 の画面に出ないが、翻訳は先に置いてある
      （User / Workspace の割り当てが入ったとき、列を足すだけで済むように）。
    */
    'settings.keyboard.sources.default',
    'settings.keyboard.sources.user',
    'settings.keyboard.sources.workspace'
  ] as const

  for (const language of LANGUAGE_IDS) {
    it(`${language} ですべて解決できる`, () => {
      const t = createTranslator(language)

      for (const key of LABEL_KEYS) {
        expect(t(key), key).not.toBe(key)
        expect(t(key).length, key).toBeGreaterThan(0)
      }
    })
  }

  it('該当なしの文言に検索語が入る', () => {
    for (const language of LANGUAGE_IDS) {
      const t = createTranslator(language)
      const message = t('settings.keyboard.noResults', { query: 'zzz' })

      expect(message).toContain('zzz')
      expect(message).not.toContain('{query}')
    }
  })
})
