import { isSettingsSectionId, type SettingsSectionId } from '@shared/settings'

/**
 * Settings 画面に何がどの順で並ぶか（Session 4-3B）。
 *
 * ## 目録と、値を持つ場所を分ける
 *
 * ここが持つのは**並び順・名前・短い説明**だけで、値も既定も範囲も持たない。
 * 値の持ち主は Session 3-5 〜 3-7-5 から一貫して機能の側にある。
 *
 * ```
 * settingsCatalog.ts        何が、どのカテゴリに、どの順で並ぶか（ここ。React 非依存）
 * SettingsOverlay.tsx       それをどう描き、どの setter へ繋ぐか
 * useEditorSession.ts       Auto Save の値と setter
 * FilesViewProvider.tsx     Files の見え方の値と setter
 * useTerminalSettings.ts    Terminal の見え方の値と setter
 * settings/useSettingsSection.ts  いつ読み、いつ書くか（Session 4-3A）
 * ```
 *
 * 分けてあるのは、**「画面に何が並ぶか」だけを試せるようにするため**にほかならない。
 * このプロジェクトのテストは Electron にも React にも DOM にも依存しない層だけを
 * 対象にしており（vitest.config.ts）、目録をここへ出しておけば
 * 「空のカテゴリが出ていないか」「載せないと決めたものが載っていないか」を
 * 画面を起動せずに確かめられる。
 *
 * ## 中身の無いカテゴリを作らない
 *
 * `general`・`git`・`workspace`・`language`（LSP）・`debug`（DAP）はここに**無い**。
 * 並べるものがまだ1つも無いためで、空のカテゴリは「まだ何も無い場所」を画面に
 * 作るだけになる（保存側で「中身が決まっていない section を先に作らない」と
 * しているのと同じ線 ── shared/settings/sections.ts）。
 *
 * `appearance` は Session 4-4 で**中身ができたので足した**。この形で入った
 * 最初のカテゴリで、触ったのはこの表と `SettingsCategoryId` だけになる。
 * **項目を1つも持たないカテゴリは足せない**（テストが落ちる）。
 *
 * ## Files のカラムの幅がここに無い理由
 *
 * 保存されている設定は6つあるが、この画面に並ぶのは5つになる。
 * カラムの幅（`files.columnWidth`）は**掴んで動かして決めるもの**で、
 * 数字で入れたい人はいない ── 動かしている最中に結果が見えることがこの値の
 * すべてで、画面を覆う Settings の中に数字の欄として置くと、閉じてから
 * 確かめることになる。操作は FileColumns.tsx の直接操作のまま残してある。
 *
 * 保存基盤の側では今までどおり `files` section の key として持ち続ける
 * （消しても schema を変えてもいない）。
 */

/** Settings 画面のカテゴリ。**中身のあるものだけ**を並べる。 */
export type SettingsCategoryId = 'editor' | 'files' | 'terminal' | 'appearance'

/**
 * 1つの設定項目。
 *
 * `id` は画面の目印（`data-testid`）にも使う。`section` はその値が保存される
 * section で、**目録と保存形式が食い違っていないことを試せる**ようにするために持つ。
 */
export interface SettingsItemDescriptor {
  readonly id: string
  /** 設定の名前（画面に出る）。 */
  readonly title: string
  /** 1行の説明。**無くても意味が通る名前**にしたうえで、補足だけを書く。 */
  readonly description: string
  /** この項目の値が入る section（shared/settings/sections.ts）。 */
  readonly section: SettingsSectionId
}

export interface SettingsCategoryDescriptor {
  readonly id: SettingsCategoryId
  /** カテゴリの名前（左の一覧に出る）。 */
  readonly title: string
  /** カテゴリの1行説明（右の見出しの下に出る）。 */
  readonly description: string
  /** 並べる項目。**空にはできない**（中身の無いカテゴリを作らない）。 */
  readonly items: readonly SettingsItemDescriptor[]
}

/**
 * 並ぶものすべて。
 *
 * 順序は「よく変えるものから」ではなく**機能の並び**（Editor / Files / Terminal）に
 * 合わせてある ── 保存ファイルの section の並びとも、Workspace のパネルの並びとも
 * 同じで、探す人が別の順序を覚え直さずに済む。
 *
 * **Appearance は末尾**（Session 4-4）。前の3つが「その機能の見え方・振る舞い」
 * であるのに対し、Appearance は**アプリ全体の見た目**にあたる ── 機能の並びの
 * 途中に挟むと、どの機能の話をしているのか分からない場所ができる。
 * 保存ファイルの section の並びとも同じにしてある。
 */
export const SETTINGS_CATEGORIES: readonly SettingsCategoryDescriptor[] = [
  {
    id: 'editor',
    title: 'Editor',
    description: '編集中のファイルをいつ保存するか。',
    items: [
      {
        id: 'editor.autoSaveMode',
        title: '自動保存',
        description: '自動で保存する場面を選びます。しない場合も Ctrl+S はいつでも効きます。',
        section: 'editor'
      },
      {
        id: 'editor.autoSaveDelayMs',
        title: '自動保存までの待ち時間',
        description: '「入力が止まったら」を選んでいるときに、止まってから保存するまでの長さです。',
        section: 'editor'
      }
    ]
  },
  {
    id: 'files',
    title: 'Files',
    description: 'ファイル一覧の見え方。',
    items: [
      {
        id: 'files.viewMode',
        title: '表示方式',
        description:
          'パネルの形に任せると、横に広ければカラム、縦に長ければツリーになります。カラムの幅は境界を掴んで変えます。',
        section: 'files'
      }
    ]
  },
  {
    id: 'terminal',
    title: 'Terminal',
    description: 'ターミナルの見え方。開いているタブすべてに効きます。',
    items: [
      {
        id: 'terminal.fontSize',
        title: '文字の大きさ',
        description: 'ターミナルのタブ列（⚙）からも変えられます。Ctrl + ＋ / － でも動きます。',
        section: 'terminal'
      },
      {
        id: 'terminal.scrollback',
        title: 'さかのぼれる行数',
        description: '減らすと、そのぶん古い出力はその場で捨てられます。',
        section: 'terminal'
      }
    ]
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'アプリ全体の見た目。',
    items: [
      {
        id: 'appearance.theme',
        title: 'テーマ',
        description:
          '選ぶとすぐに切り替わります。エディタ・ファイル一覧・ターミナル・Git のすべてに効きます。',
        section: 'appearance'
      }
    ]
  }
]

/** 開いたときに最初に出るカテゴリ。 */
export const DEFAULT_SETTINGS_CATEGORY_ID: SettingsCategoryId = 'editor'

/** 並べる順に取り出す。 */
export function listSettingsCategories(): readonly SettingsCategoryDescriptor[] {
  return SETTINGS_CATEGORIES
}

/**
 * カテゴリを1つ取り出す。
 *
 * 知らない名前は既定のカテゴリへ落とす ── 画面が真っ白になるより、
 * 最初のカテゴリが出ている方が行き止まりにならない。
 */
export function getSettingsCategory(id: SettingsCategoryId): SettingsCategoryDescriptor {
  return (
    SETTINGS_CATEGORIES.find((category) => category.id === id) ??
    SETTINGS_CATEGORIES.find((category) => category.id === DEFAULT_SETTINGS_CATEGORY_ID) ??
    SETTINGS_CATEGORIES[0]
  )
}

/** 素の文字列が、今ある カテゴリの名前か。 */
export function isSettingsCategoryId(value: unknown): value is SettingsCategoryId {
  return typeof value === 'string' && SETTINGS_CATEGORIES.some((category) => category.id === value)
}

/**
 * この画面に並ぶ項目すべて（カテゴリの順・その中の順）。
 *
 * 目録が保存形式と食い違っていないかを確かめるために使う（テスト）。
 */
export function listSettingsItems(): readonly SettingsItemDescriptor[] {
  return SETTINGS_CATEGORIES.flatMap((category) => category.items)
}

/** 目録の中の section 名がすべて既知か（shared 側の閉じた集合との突き合わせ）。 */
export function hasKnownSections(): boolean {
  return listSettingsItems().every((item) => isSettingsSectionId(item.section))
}
