import type { TFunction, TranslationKey } from '../i18n/messages'
import type { CommandCategory } from './types'

/**
 * Command のカテゴリの表示名と、並べる順（Session 4-7C）。
 *
 * `workspace/panels/panelLabels.ts` と同じ形にしてある ── **内部 ID と表示名を
 * 分ける**ためのファイルで、`CommandCategory`（`'git'`）は識別子のまま、
 * 画面に出るのは翻訳を通った文字列になる。
 *
 * ## `commands/` に置く理由
 *
 * 読むのは今のところ Settings の Keyboard Shortcuts 一覧だけだが、
 * **将来の Command Palette も同じものを必要とする**（VS Code が
 * `Category: Title` の形で出しているもの）。`settings/` に置くと、
 * Palette が Settings の中身へ手を伸ばすことになる。
 *
 * 共有できるのは descriptor の層までで、`useCommands()` の
 * `isRegistered` / `execute`（今それが実行できるか）は Palette だけが使う
 * ── 一覧は閲覧専用なのでそちらへ触らない。
 */

/**
 * カテゴリの表示名。
 *
 * `Record<CommandCategory, …>` なので、`CommandCategory` を増やすと
 * **ここが型エラーになる** ── 名前の無いカテゴリが画面に出ることがない。
 */
const COMMAND_CATEGORY_TITLE_KEYS: Readonly<Record<CommandCategory, TranslationKey>> = {
  workspace: 'settings.keyboard.categories.workspace',
  editor: 'settings.keyboard.categories.editor',
  view: 'settings.keyboard.categories.view',
  settings: 'settings.keyboard.categories.settings',
  debug: 'settings.keyboard.categories.debug',
  git: 'settings.keyboard.categories.git',
  files: 'settings.keyboard.categories.files'
}

/**
 * 一覧に並べる順。
 *
 * `COMMAND_IDS` の並びと同じだが、**そちらに依存させていない。**
 * あちらは「command の名前の一覧」で、たまたまカテゴリごとに固まっているだけ
 * ── 行を足す場所しだいで崩れうる順序を、画面の並びの正本にしない
 * （registry.ts の「並び」と同じ理由）。
 */
export const COMMAND_CATEGORY_ORDER: readonly CommandCategory[] = [
  'workspace',
  'editor',
  'view',
  'settings',
  'debug',
  'git',
  'files'
]

/** カテゴリの表示名を引く。 */
export function getCommandCategoryTitle(category: CommandCategory, t: TFunction): string {
  return t(COMMAND_CATEGORY_TITLE_KEYS[category])
}
