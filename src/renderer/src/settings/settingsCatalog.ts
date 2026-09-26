import {
  isSettingsSectionId,
  type SettingsSectionId,
  type SettingsSections
} from '@shared/settings'
import type { TranslationKey } from '../i18n/messages'

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
 * `git`・`workspace`・`debug`（DAP）はここに**無い**。並べるものがまだ1つも
 * 無いためで、空のカテゴリは「まだ何も無い場所」を画面に作るだけになる
 * （保存側で「中身が決まっていない section を先に作らない」としているのと
 * 同じ線 ── shared/settings/sections.ts）。
 *
 * `appearance` は Session 4-4 で**中身ができたので足した**。この形で入った
 * 最初のカテゴリで、触ったのはこの表と `SettingsCategoryId` だけになる。
 * **項目を1つも持たないカテゴリは足せない**（テストが落ちる）。
 *
 * `lsp` は Session 5-4 で同じ形で入った2つめにあたる。並べるのは
 * 「使うかどうか」だけで、**実行ファイルの場所も引数も並べない**
 * ── 保存形式にその欄が無いためで、画面の都合で欄を増やすことはしない
 * （shared/settings/sections.ts の `StoredLspSettings`）。
 *
 * 置き場所は Editor の次にしてある。Language Server が効くのは Editor の中
 * （診断・この先の補完や定義へ移動）で、探す人が Editor の近くを見るため。
 *
 * ## カテゴリには2種類ある（Session 4-7C）
 *
 * Session 4-7C まで、カテゴリは `SettingsSectionId` と **ID も並びも1対1**
 * だった ── どのカテゴリも「保存される値の項目」を並べるものだったため、
 * その一致は自然に成り立っていた。
 *
 * Keyboard Shortcuts はそこから外れる**最初のカテゴリ**にあたる。
 *
 *   - 並べるのは値の項目ではなく、**Command と打鍵の一覧表**
 *   - したがって `SettingsItemDescriptor`（`section` 必須）に乗らない
 *   - **保存するものが1つも無い** ── 対応する section が存在しない
 *
 * そこでカテゴリを `kind` で分けた判別可能なユニオンにしてある。
 *
 *   `kind: 'items'`     … 値の項目が並ぶ。`SettingsSectionId` と1対1（従来どおり）
 *   `kind: 'shortcuts'` … 一覧表。section を持たない
 *
 * **1対1の約束は消えていない。** 移ったのは掛かる相手だけで、
 * 「**値カテゴリ**の並びが section の並びと一致する」は今も成り立つ
 * （settingsCatalog.test.ts）── `keyboard` を末尾に置いてあるのは、
 * 値カテゴリがこの配列の前方にそのまま残るようにするためでもある。
 *
 * `shared/settings/sections.ts` は Session 4-7C で1行も変えていない。
 */

/**
 * 保存形式にはあるが、**Settings 画面にまだカテゴリを持たない** section。
 *
 * `security`（FN Agent の Permission。Security Core v1 の STEP1）が最初にあたる。
 * 値を読む Agent がまだ無く、効き目の無い項目を画面に出すと利用者が迷うため、
 * 画面は Agent が実際にこの設定を使う段階で足す（そのときここから外す）。
 * 画面が無い間は、Renderer からこの section を書く経路も無い。
 *
 * 1対1の約束は「**画面を持つ** section」に掛かる。ここに挙げた section は
 * `SETTINGS_SECTION_IDS` の末尾に置き、値カテゴリの並びが前方一致のまま残るようにしてある。
 */
export const SETTINGS_SECTIONS_WITHOUT_CATEGORY = [
  'security'
] as const satisfies readonly SettingsSectionId[]

/** 値の項目が並ぶカテゴリ。**画面を持つ `SettingsSectionId` と1対1**（並びも同じ）。 */
export type SettingsValueCategoryId = Exclude<
  SettingsSectionId,
  (typeof SETTINGS_SECTIONS_WITHOUT_CATEGORY)[number]
>

/** Settings 画面のカテゴリ。**中身のあるものだけ**を並べる。 */
export type SettingsCategoryId = SettingsValueCategoryId | 'keyboard'

/**
 * 1つの設定項目。
 *
 * `id` は画面の目印（`data-testid`）にも使う。`section` はその値が保存される
 * section で、**目録と保存形式が食い違っていないことを試せる**ようにするために持つ。
 */
interface SettingsItemDescriptorBase {
  readonly id: string
  /** 設定の名前（画面に出る）。 */
  readonly titleKey: TranslationKey
  /** 1行の説明。**無くても意味が通る名前**にしたうえで、補足だけを書く。 */
  readonly descriptionKey: TranslationKey
}

/**
 * section と、その中でこの項目が読み書きする key（feature/settings-scope）。
 *
 * key を持つのは、ワークスペース設定で**この項目が上書きされているか**を画面が
 * 判断し、「ユーザー設定に戻す」でどの key を外すかを決めるため。
 * section と key の対応は型で縛ってある（別の section の key は書けない）。
 *
 * **key が空の項目**は、設定ファイルに値を持たない行になる（Updates ──
 * 状態と操作はアップデートの仕組みが持つ）。上書きの表示も「ユーザー設定に戻す」も
 * 出ない。section はワークスペースで押せるかどうかを決めるためだけに持つ。
 */
type SettingsItemLocation = {
  readonly [Id in SettingsSectionId]: {
    /** この項目の値が入る section（shared/settings/sections.ts）。 */
    readonly section: Id
    /** この項目が読み書きする key（1つ以上。値を持たない行だけ空）。 */
    readonly keys:
      | readonly []
      | readonly [keyof SettingsSections[Id] & string, ...(keyof SettingsSections[Id] & string)[]]
  }
}[SettingsSectionId]

export type SettingsItemDescriptor = SettingsItemDescriptorBase & SettingsItemLocation

/** どのカテゴリにも共通するもの（左の一覧と右の見出しが読む）。 */
interface SettingsCategoryBase {
  /** カテゴリの名前（左の一覧に出る）。 */
  readonly titleKey: TranslationKey
  /** カテゴリの1行説明（右の見出しの下に出る）。 */
  readonly descriptionKey: TranslationKey
}

/**
 * 値の項目の下に続く、そのカテゴリだけの面（MCP Server Manager）。
 *
 * MCP は「使うかどうか」（全体の元栓）のほかに、**設定ファイルに無いもの**を
 * 画面に出す必要がある ── 登録したサーバー（登録簿は別のファイル）・今の接続状態・
 * 接続テストにほかならない。どれも `SettingsItemDescriptor`
 * （section と key を指すもの）では表せない。
 *
 * カテゴリごと `kind` を分けなかったのは、**全体の元栓は普通の設定項目**
 * だからになる。分けると scope の扱い（application なので
 * ワークスペースでは押せない）・上書きの表示・保存の経路を、
 * このカテゴリのためにもう一組書くことになる。
 */
export type SettingsCategoryPanelId = 'mcp' | 'aiProvider'

/** 値の項目が並ぶカテゴリ（Session 4-3B からの形）。 */
export interface SettingsItemsCategoryDescriptor extends SettingsCategoryBase {
  readonly kind: 'items'
  readonly id: SettingsValueCategoryId
  /** 並べる項目。**空にはできない**（中身の無いカテゴリを作らない）。 */
  readonly items: readonly SettingsItemDescriptor[]
  /** 項目の下に続く面（あれば）。 */
  readonly panel?: SettingsCategoryPanelId
}

/**
 * 一覧表のカテゴリ（Session 4-7C）。
 *
 * `items` を持たない ── 並べるものは目録ではなく
 * `commands/registry.ts` ＋ `keybindings/` から**実行時に組み立てられる**
 * （`keybindings/shortcutRows.ts` の `buildShortcutRows`）。
 * ここに書き写すと、command を足すたびに2箇所を直すことになる。
 */
export interface SettingsShortcutsCategoryDescriptor extends SettingsCategoryBase {
  readonly kind: 'shortcuts'
  readonly id: 'keyboard'
}

export type SettingsCategoryDescriptor =
  SettingsItemsCategoryDescriptor | SettingsShortcutsCategoryDescriptor

/**
 * 並ぶものすべて。
 *
 * 順序は「よく変えるものから」ではなく**機能の並び**（Editor / LSP / Files / Terminal）に
 * 合わせてある ── 保存ファイルの section の並びとも同じで、探す人が
 * 別の順序を覚え直さずに済む。
 *
 * **Keyboard Shortcuts は末尾**（Session 4-7C）。値カテゴリの並びを
 * `SETTINGS_SECTION_IDS` と同じまま保つためで、値を変える場所と
 * 一覧を見る場所を混ぜないためでもある。
 */
export const SETTINGS_CATEGORIES: readonly SettingsCategoryDescriptor[] = [
  {
    kind: 'items',
    id: 'general',
    titleKey: 'settings.categories.general.title',
    descriptionKey: 'settings.categories.general.description',
    items: [
      {
        id: 'general.language',
        titleKey: 'settings.items.general.language.title',
        descriptionKey: 'settings.items.general.language.description',
        section: 'general',
        keys: ['language']
      },
      {
        id: 'general.updates',
        titleKey: 'settings.items.general.updates.title',
        descriptionKey: 'settings.items.general.updates.description',
        section: 'general',
        keys: []
      }
    ]
  },
  {
    kind: 'items',
    id: 'appearance',
    titleKey: 'settings.categories.appearance.title',
    descriptionKey: 'settings.categories.appearance.description',
    items: [
      {
        id: 'appearance.theme',
        titleKey: 'settings.items.appearance.theme.title',
        descriptionKey: 'settings.items.appearance.theme.description',
        section: 'appearance',
        keys: ['theme']
      }
    ]
  },
  {
    kind: 'items',
    id: 'editor',
    titleKey: 'settings.categories.editor.title',
    descriptionKey: 'settings.categories.editor.description',
    items: [
      {
        id: 'editor.autoSaveMode',
        titleKey: 'settings.items.editor.autoSaveMode.title',
        descriptionKey: 'settings.items.editor.autoSaveMode.description',
        section: 'editor',
        keys: ['autoSaveMode']
      },
      {
        id: 'editor.autoSaveDelayMs',
        titleKey: 'settings.items.editor.autoSaveDelayMs.title',
        descriptionKey: 'settings.items.editor.autoSaveDelayMs.description',
        section: 'editor',
        keys: ['autoSaveDelayMs']
      }
    ]
  },
  {
    kind: 'items',
    id: 'lsp',
    titleKey: 'settings.categories.lsp.title',
    descriptionKey: 'settings.categories.lsp.description',
    items: [
      {
        id: 'lsp.enabled',
        titleKey: 'settings.items.lsp.enabled.title',
        descriptionKey: 'settings.items.lsp.enabled.description',
        section: 'lsp',
        keys: ['enabled']
      },
      {
        id: 'lsp.servers',
        titleKey: 'settings.items.lsp.servers.title',
        descriptionKey: 'settings.items.lsp.servers.description',
        section: 'lsp',
        keys: ['typescriptEnabled', 'pythonEnabled', 'csharpEnabled']
      }
    ]
  },
  {
    kind: 'items',
    id: 'files',
    titleKey: 'settings.categories.files.title',
    descriptionKey: 'settings.categories.files.description',
    items: [
      {
        id: 'files.viewMode',
        titleKey: 'settings.items.files.viewMode.title',
        descriptionKey: 'settings.items.files.viewMode.description',
        section: 'files',
        keys: ['viewMode']
      }
    ]
  },
  {
    kind: 'items',
    id: 'terminal',
    titleKey: 'settings.categories.terminal.title',
    descriptionKey: 'settings.categories.terminal.description',
    items: [
      {
        id: 'terminal.fontSize',
        titleKey: 'settings.items.terminal.fontSize.title',
        descriptionKey: 'settings.items.terminal.fontSize.description',
        section: 'terminal',
        keys: ['fontSize']
      },
      {
        id: 'terminal.scrollback',
        titleKey: 'settings.items.terminal.scrollback.title',
        descriptionKey: 'settings.items.terminal.scrollback.description',
        section: 'terminal',
        keys: ['scrollback']
      }
    ]
  },
  /*
    MCP のカテゴリ。Terminal の次・Keyboard Shortcuts の手前に置いたのは、
    値カテゴリの並びを `SETTINGS_SECTION_IDS` と同じまま保つためにほかならない。

    並べる項目は全体の元栓の1つだけで、**登録したサーバーはここに無い**
    ── 登録簿は設定の値ではないため（`panel` が出す MCP Server Manager）。
  */
  {
    kind: 'items',
    id: 'mcp',
    titleKey: 'settings.categories.mcp.title',
    descriptionKey: 'settings.categories.mcp.description',
    items: [
      {
        id: 'mcp.enabled',
        titleKey: 'settings.items.mcp.enabled.title',
        descriptionKey: 'settings.items.mcp.enabled.description',
        section: 'mcp',
        keys: ['enabled']
      }
    ],
    panel: 'mcp'
  },
  /*
    FN Agent の AI Provider（STEP10-5）。並べる項目は Provider と Model の選択（allowlist から選ぶ）で、
    **API Key はここに無い** ── Key は設定の値ではないため（`panel` が出す API Key の面）。
    Endpoint の項目も無い（Provider Adapter の内部に固定する）。
  */
  {
    kind: 'items',
    id: 'aiProvider',
    titleKey: 'settings.categories.aiProvider.title',
    descriptionKey: 'settings.categories.aiProvider.description',
    items: [
      {
        id: 'aiProvider.provider',
        titleKey: 'settings.items.aiProvider.provider.title',
        descriptionKey: 'settings.items.aiProvider.provider.description',
        section: 'aiProvider',
        keys: ['providerId']
      },
      {
        id: 'aiProvider.model',
        titleKey: 'settings.items.aiProvider.model.title',
        descriptionKey: 'settings.items.aiProvider.model.description',
        section: 'aiProvider',
        keys: ['modelId']
      }
    ],
    panel: 'aiProvider'
  },
  {
    kind: 'shortcuts',
    id: 'keyboard',
    titleKey: 'settings.categories.keyboard.title',
    descriptionKey: 'settings.categories.keyboard.description'
  }
]

/** 開いたときに最初に出るカテゴリ。 */
export const DEFAULT_SETTINGS_CATEGORY_ID: SettingsCategoryId = 'general'

/** 並べる順に取り出す。 */
export function listSettingsCategories(): readonly SettingsCategoryDescriptor[] {
  return SETTINGS_CATEGORIES
}

/**
 * 値の項目が並ぶカテゴリだけを取り出す（Session 4-7C）。
 *
 * 保存形式との対応を確かめるために使う ── 一覧表のカテゴリは section を
 * 持たないので、そちらまで含めて突き合わせることはできない。
 */
export function listSettingsValueCategories(): readonly SettingsItemsCategoryDescriptor[] {
  return SETTINGS_CATEGORIES.filter(
    (category): category is SettingsItemsCategoryDescriptor => category.kind === 'items'
  )
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
  return listSettingsValueCategories().flatMap((category) => category.items)
}

/** 目録の中の section 名がすべて既知か（shared 側の閉じた集合との突き合わせ）。 */
export function hasKnownSections(): boolean {
  return listSettingsItems().every((item) => isSettingsSectionId(item.section))
}
