import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  isOverriddenInWorkspace,
  isWorkspaceScopedSection,
  SETTINGS_SCOPES,
  type SettingsScope,
  type SettingsSectionId
} from '@shared/settings'
import {
  AUTO_SAVE_DELAY_MAX_MS,
  AUTO_SAVE_DELAY_MIN_MS,
  AUTO_SAVE_MODES,
  AUTO_SAVE_SETTINGS_BINDING,
  createAutoSaveSetters,
  normalizeAutoSaveSettings,
  type AutoSaveMode
} from '../editor/autoSave'
import {
  createFilesViewSetters,
  FILES_VIEW_CHOICES,
  FILES_VIEW_SETTINGS_BINDING,
  fromFilesViewChoice,
  toFilesViewChoice,
  type FilesViewChoice
} from '../files/filesSettings'
import { useI18n } from '../i18n/context'
import { readDocumentLanguage } from '../i18n/documentLanguage'
import {
  createLanguageSetters,
  LANGUAGE_CHOICES,
  LANGUAGE_SETTINGS_BINDING
} from '../i18n/languageSettings'
import type { TranslationKey } from '../i18n/messages'
import { languageServerNameKey } from '../lsp/languageServerLabels'
import { createLanguageServerSetters, LSP_SETTINGS_BINDING } from '../lsp/lspSettingsBinding'
import { LANGUAGE_SERVER_IDS } from '@shared/lsp'
import { MCP_CONNECTION_IDS } from '@shared/mcp'
import { McpConnectionPanel } from '../mcp/McpConnectionPanel'
import { createMcpSetters, MCP_SETTINGS_BINDING } from '../mcp/mcpSettingsBinding'
import {
  createTerminalDisplaySetters,
  TERMINAL_DISPLAY_SETTINGS_BINDING
} from '../terminal/terminalSettings'
import {
  APPEARANCE_SETTINGS_BINDING,
  APPEARANCE_THEME_CHOICES,
  createAppearanceSetters
} from '../theme/appearanceSettings'
import { readDocumentTheme } from '../theme/documentTheme'
import {
  clampTerminalFontSize,
  clampTerminalScrollback,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN
} from '../terminal/terminalDisplay'
import { NumberField } from '../ui/NumberField'
import { UpdateSettingsControl } from '../updates/UpdateSettingsControl'
import { KeyboardShortcutsView } from './KeyboardShortcutsView'
import { useSettingsScope } from './scopeContext'
import type { SettingsSectionBinding, SettingsValueUpdate } from './settingsBinding'
import { useScopedSettingsSection } from './useSettingsSection'
import {
  DEFAULT_SETTINGS_CATEGORY_ID,
  getSettingsCategory,
  listSettingsCategories,
  type SettingsCategoryDescriptor,
  type SettingsCategoryId,
  type SettingsItemDescriptor,
  type SettingsItemsCategoryDescriptor
} from './settingsCatalog'
import './settings.css'

/**
 * アプリ全体の設定を並べる面（Session 4-3B）。
 *
 * DESIGN.md §9 で「そのうち作る」とされていた Settings がこれにあたる。
 * Session 4-3A で保存の側（`settings.json` ・section・IPC 2本）が揃い、
 * 残っていたのは**並べる場所**だけだった。
 *
 * ## ウィンドウ全体に重ねる（Dock 対象にしない）
 *
 * Git の差分・履歴・退避と同じ「面」の形をとる。パネルにしなかった理由は2つ。
 *
 *   - **設定はどのパネルのものでもない。** Editor / Files / Terminal の3つに
 *     またがるので、どこかのパネルの中に置くと、そのパネルを閉じた人から
 *     設定が消える
 *   - **レイアウトを占有しない。** 設定を見ている間だけ前に出て、閉じれば
 *     作業していた配置がそのまま残る（Dock すると、開くたびに配置が動く）
 *
 * `position: fixed` で窓いっぱいに敷く（settings.css）── Git の面が
 * パネルの中に敷かれるのと違い、こちらは上部バーごと覆う。Git の面は
 * 「そのパネルについての面」だが、こちらは**アプリについての面**にほかならない。
 *
 * ## 非モーダル
 *
 * `aria-modal="false"`。背後を操作できなくする仕掛け（focus trap・背面のクリック
 * 無効化）は持たない ── 設定は「今している作業を止めてまで確定させるもの」では
 * なく、Git の面と同じ扱いで揃えてある。
 *
 * ## 閉じ方は2つ
 *
 *   面の中の `×`  … 見えている閉じ方
 *   Esc          … Git の面・メニュー・確認と同じ打鍵
 *
 * **閉じても値は失われない。** 変えた瞬間に setter へ渡り、そこから
 * `useSettingsSection` が保存する（Session 4-3A）── この面は「編集して OK で
 * 確定する」形ではないので、閉じることで捨てられるものが1つも無い。
 *
 * ## 値は1つも持たない
 *
 * この面は state として**開いているカテゴリと、編集している scope しか持たない。**
 * 設定の値はすべて既存の正本から読み、既存の変え方で返す。
 *
 * | 項目                      | 正本                                    | 既存 UI                       |
 * | ------------------------- | --------------------------------------- | ----------------------------- |
 * | Auto Save の方式・待ち時間 | `useEditorSession`（editor/context.ts） | 無し（4-3B でここへ移した）   |
 * | Files の表示方式          | `FilesViewProvider`                     | Files のツールバー（残す）    |
 * | Terminal の文字の大きさ   | `useTerminalSettings`                   | Terminal の ⚙（残す）        |
 * | Terminal のさかのぼれる行数 | `useTerminalSettings`                 | 無し（4-3B でここへ移した）   |
 * | Theme                     | `useAppearance`（theme/context.ts）     | 無し（4-4 でここが唯一の口）  |
 * | Language Server の有効 / 無効 | `LspSettingsProvider`（lsp/context.ts） | 無し（5-4 でここが唯一の口） |
 *
 * **同じ値を指す state をここに作らない**のが要点で、作った瞬間に
 * 「Settings で変えたのに Files パネルが変わらない」「ツールバーで変えたのに
 * Settings が古い値を出す」が生まれる。片方で変えればもう片方にもその場で出るのは、
 * 二重に持っていないからにほかならない。
 *
 * ## ユーザー設定 / ワークスペース設定（feature/settings-scope）
 *
 * 面の上に `ユーザー | ワークスペース` の切り替えを置き、**今どちらを編集しているかを
 * 常に見せる**（面の本体に scope ごとの色の帯と説明が付く）。
 *
 *   ユーザー       … 行はユーザー設定の値を出し、変えるとユーザー設定へ書く
 *   ワークスペース … 行はこのプロジェクトで実際に効く値を出し、変えるとワークスペース設定へ書く
 *
 * そのため行の操作 UI は、上の表の Context ではなく**選んでいる scope から見た値**を
 * 読む（settings/useSettingsSection.ts の `useScopedSettingsSection`）。上の表の
 * 正本と同じ binding・同じ変え方（`create…Setters`）を使うので、値の意味が
 * 2つに割れることはなく、「同じ値を指す state をここに作らない」も変わらない
 * ── 値は今も SettingsScopeProvider の1箇所にしか無い。
 *
 * Workspace を開いていないときにワークスペースを選んだ場合は、エラーにせず
 * 「開けば変えられる」ことだけを案内する。
 *
 * ## 値を持たないカテゴリ（Session 4-7C）
 *
 * Keyboard Shortcuts は**設定を1つも持たない**カテゴリで、
 * Command と打鍵の一覧を読むだけの場所にあたる（KeyboardShortcutsView.tsx）。
 * 保存も IPC も増えていない ── この面がもともと値を持たない設計だったので、
 * 「保存されない中身」を足すのに新しい約束が要らなかった。
 *
 * ## 並ぶものはここが決めていない
 *
 * カテゴリと項目の並びは settingsCatalog.ts（React 非依存・テスト対象）が持つ。
 * このファイルが持つのは配置と、どの setter へ繋ぐかだけ ── GitView.tsx が
 * 文言と押せる条件を持たないのと同じ分担になる。
 */
export function SettingsOverlay({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const { t } = useI18n()
  const categories = listSettingsCategories()

  /*
    開いているカテゴリ。この面が持つ state は、これと下の scope の2つだけ。

    保存しないのは、Settings が「今どこを見ていたか」を覚えている必要が無いため
    ── 開くたびに Editor から始まる方が、どこを見ていたか思い出さずに済む。
  */
  const [categoryId, setCategoryId] = useState<SettingsCategoryId>(DEFAULT_SETTINGS_CATEGORY_ID)
  const category = getSettingsCategory(categoryId)

  /*
    編集している scope（feature/settings-scope）。これも保存しない ── 開くたびに
    ユーザー設定から始まる方が、「気づかないうちにこのプロジェクトだけ変えていた」を防げる。
  */
  const [scope, setScope] = useState<SettingsScope>('user')

  /*
    Esc で閉じる。購読先が `window` なのは、面の中に focus が無くても効かせるため
    （Git の面とまったく同じ形）。この面の上に何かが重なることは無いので、
    `suspended` のような仕組みは持たない。
  */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="fx-settings"
      data-testid="settings"
      role="dialog"
      aria-modal="false"
      aria-label={t('settings.title')}
    >
      <div className="fx-settings__bar">
        <span className="fx-settings__title">{t('settings.title')}</span>
        <button
          type="button"
          className="fx-settings__close"
          data-testid="settings-close"
          onClick={onClose}
          title={t('settings.closeTitle')}
          aria-label={t('settings.closeLabel')}
        >
          ×
        </button>
      </div>

      <SettingsScopeBar scope={scope} onChange={setScope} />

      <div className="fx-settings__body">
        {/*
          カテゴリの一覧。上部バーの View / Layout のようなメニューにしなかったのは、
          **今どこを見ているかが常に見えている**方がよいため ── 数が限られているので
          畳む必要が無く、畳むと切り替えのたびに2回押すことになる。
        */}
        <nav className="fx-settings__nav" aria-label={t('settings.categoryNavLabel')}>
          {categories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="fx-settings__nav-item"
              data-testid={`settings-category-${entry.id}`}
              data-active={entry.id === categoryId}
              aria-current={entry.id === categoryId}
              onClick={() => setCategoryId(entry.id)}
            >
              {t(entry.titleKey)}
            </button>
          ))}
        </nav>

        <div
          className="fx-settings__content"
          data-category={category.id}
          data-scope={scope}
          data-testid="settings-content"
        >
          <div className="fx-settings__heading">
            <h2 className="fx-settings__heading-title">{t(category.titleKey)}</h2>
            <p className="fx-settings__heading-note">{t(category.descriptionKey)}</p>
          </div>

          <SettingsCategoryBody category={category} scope={scope} />
        </div>
      </div>
    </div>
  )
}

/**
 * カテゴリの中身。
 *
 * **`kind` で2つに分かれる**（Session 4-7C。settingsCatalog.ts）。
 *
 *   `items`     … 値の項目が並ぶ（Session 4-3B からの形）
 *   `shortcuts` … Command と打鍵の一覧表（閲覧専用）
 *
 * 判別可能なユニオンなので、3つめの `kind` を足すと**ここが型エラーになる**
 * ── 中身の出ないカテゴリが黙って生まれることがない。
 */
function SettingsCategoryBody({
  category,
  scope
}: {
  readonly category: SettingsCategoryDescriptor
  readonly scope: SettingsScope
}): JSX.Element {
  const { workspace } = useSettingsScope()

  if (category.kind === 'shortcuts') {
    return <KeyboardShortcutsView />
  }

  /*
    Workspace を開いていないのにワークスペースを選んだ。エラーにはせず、
    開けば何ができるかだけを言う（押せない行を並べると、壊れているように見える）。
  */
  if (scope === 'workspace' && workspace === null) {
    return <WorkspaceSettingsUnavailable />
  }

  return (
    <>
      {category.items.map((item) => (
        <SettingsRow key={item.id} item={item} scope={scope} />
      ))}
      <SettingsCategoryPanel category={category} scope={scope} />
    </>
  )
}

/**
 * 値の項目の下に続く、そのカテゴリだけの面（§21.9）。
 *
 * **ユーザー設定を見ているときだけ出す。** MCP は application scope なので
 * （shared/settings/scope.ts）、ワークスペースを選んでいる間に token の欄や
 * 接続テストを出すと、「このプロジェクトだけの設定」に見える ── 上の行が
 * 押せない状態で理由を添えているので、面は畳んでよい。
 */
function SettingsCategoryPanel({
  category,
  scope
}: {
  readonly category: SettingsItemsCategoryDescriptor
  readonly scope: SettingsScope
}): JSX.Element | null {
  if (category.panel === undefined || scope !== 'user') {
    return null
  }

  return <McpConnectionPanel />
}

/**
 * 設定1つ分の行（名前・説明・操作 UI）。
 *
 * どの項目かで中身が変わる ── 目録（settingsCatalog.ts）は「何が並ぶか」までを
 * 決め、**その値をどう操作するか**はここが決める。目録に操作 UI の種類まで
 * 持たせると、React を知らないはずの目録が React の都合を持つことになる。
 */
function SettingsRow({
  item,
  scope
}: {
  readonly item: SettingsItemDescriptor
  readonly scope: SettingsScope
}): JSX.Element {
  const { t } = useI18n()
  const { workspace } = useSettingsScope()

  /*
    ワークスペース設定で変えられない項目（表示言語。shared/settings/scope.ts）。
    隠さずに出し、押せなくして理由を添える ── 隠すと「どこで変えるのか」が分からなくなる。
  */
  const locked = scope === 'workspace' && !isWorkspaceScopedSection(item.section)
  const overridden = isOverriddenInWorkspace(workspace?.sections ?? null, item.section, item.keys)

  return (
    <section
      className="fx-settings__row"
      data-item={item.id}
      data-overridden={overridden}
      data-locked={locked}
    >
      <div className="fx-settings__row-main">
        <span className="fx-settings__row-title">{t(item.titleKey)}</span>
        <p className="fx-settings__row-note">{t(item.descriptionKey)}</p>
        <SettingsRowScopeStatus item={item} scope={scope} locked={locked} overridden={overridden} />
      </div>
      <div className="fx-settings__row-control">
        {/*
          fieldset の disabled は、中のボタン・select・数の欄をまとめて押せなくする
          （操作 UI ごとに disabled を配らずに済む）。
        */}
        <fieldset className="fx-settings__row-fieldset" disabled={locked}>
          <SettingsControl item={item} scope={scope} />
        </fieldset>
      </div>
    </section>
  )
}

/**
 * 行の scope の状態（どちらの値が効いているか）。
 *
 * | 選んでいる scope | 上書き | 出すもの                                                 |
 * | ---------------- | ------ | -------------------------------------------------------- |
 * | ワークスペース   | 無し   | 「ユーザー設定を使用中」                                 |
 * | ワークスペース   | 有り   | 「このワークスペースで変更済み」＋「ユーザー設定に戻す」 |
 * | ユーザー         | 有り   | 「このワークスペースではワークスペース設定が優先」       |
 * | ユーザー         | 無し   | 何も出さない（ふだんの形を崩さない）                     |
 */
function SettingsRowScopeStatus({
  item,
  scope,
  locked,
  overridden
}: {
  readonly item: SettingsItemDescriptor
  readonly scope: SettingsScope
  readonly locked: boolean
  readonly overridden: boolean
}): JSX.Element | null {
  const { t } = useI18n()
  const { resetWorkspaceKeys } = useSettingsScope()
  const testId = `settings-scope-status-${item.id}`

  if (locked) {
    return (
      <p className="fx-settings__scope-status" data-state="locked" data-testid={testId}>
        {t('settings.scope.status.userOnly')}
      </p>
    )
  }

  if (scope === 'user') {
    return overridden ? (
      <p className="fx-settings__scope-status" data-state="shadowed" data-testid={testId}>
        {t('settings.scope.status.shadowedByWorkspace')}
      </p>
    ) : null
  }

  if (!overridden) {
    return (
      <p className="fx-settings__scope-status" data-state="inherited" data-testid={testId}>
        {t('settings.scope.status.inherited')}
      </p>
    )
  }

  return (
    <p className="fx-settings__scope-status" data-state="overridden" data-testid={testId}>
      <span className="fx-settings__scope-badge">{t('settings.scope.status.overridden')}</span>
      <button
        type="button"
        className="fx-settings__scope-reset"
        data-testid={`settings-scope-reset-${item.id}`}
        onClick={() => resetWorkspaceKeys(item.section, item.keys)}
      >
        {t('settings.scope.reset')}
      </button>
    </p>
  )
}

/**
 * 面の上の `ユーザー | ワークスペース` の切り替えと、今どちらを編集しているかの説明。
 *
 * 説明の文言を scope ごとに変えるのは、**切り替えたことが文字でも分かる**ようにするため
 * （色だけに頼ると、Theme や色覚によっては違いが見えない）。
 */
function SettingsScopeBar({
  scope,
  onChange
}: {
  readonly scope: SettingsScope
  readonly onChange: (scope: SettingsScope) => void
}): JSX.Element {
  const { t } = useI18n()
  const { workspace } = useSettingsScope()

  const description =
    scope === 'user'
      ? t('settings.scope.userDescription')
      : workspace === null
        ? t('settings.scope.workspaceDescriptionNone')
        : t('settings.scope.workspaceDescription', { name: workspace.displayName })

  return (
    <div className="fx-settings__scope" data-scope={scope} data-testid="settings-scope">
      <div className="fx-settings__scope-tabs" role="tablist" aria-label={t('settings.scope.aria')}>
        {SETTINGS_SCOPES.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            className="fx-settings__scope-tab"
            data-testid={`settings-scope-${entry}`}
            data-active={entry === scope}
            aria-selected={entry === scope}
            onClick={() => onChange(entry)}
          >
            {t(entry === 'user' ? 'settings.scope.user' : 'settings.scope.workspace')}
          </button>
        ))}
      </div>
      <p className="fx-settings__scope-description" data-testid="settings-scope-description">
        {description}
      </p>
    </div>
  )
}

/** Workspace を開いていないときにワークスペースを選んだ場合の案内。 */
function WorkspaceSettingsUnavailable(): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="fx-settings__scope-empty" data-testid="settings-workspace-unavailable">
      <p className="fx-settings__scope-empty-title">{t('settings.scope.noWorkspace.title')}</p>
      <p className="fx-settings__scope-empty-note">{t('settings.scope.noWorkspace.note')}</p>
    </div>
  )
}

/**
 * 選んでいる scope から見た値と、その scope へ書く変え方。
 *
 * 変え方は各機能と同じ `create…Setters` を通す ── 違うのは、渡す update が
 * 「効く値を決めている scope へ書く」か「選んでいる scope へ書く」かだけになる。
 */
function useScopedSetters<Id extends SettingsSectionId, T, S extends object>(
  binding: SettingsSectionBinding<Id, T>,
  scope: SettingsScope,
  createSetters: (update: SettingsValueUpdate<T>) => S
): { readonly value: T } & S {
  const { value, update } = useScopedSettingsSection(binding, scope)
  const setters = useMemo(() => createSetters(update), [createSetters, update])

  return { value, ...setters }
}

/** 行の操作 UI が受け取るもの（どの scope から見た値を出し、どこへ書くか）。 */
interface ScopeProps {
  readonly scope: SettingsScope
}

function SettingsControl({
  item,
  scope
}: {
  readonly item: SettingsItemDescriptor
  readonly scope: SettingsScope
}): JSX.Element {
  const { t } = useI18n()

  switch (item.id) {
    case 'general.language':
      return <LanguageControl scope={scope} />

    case 'general.updates':
      return <UpdateSettingsControl />

    case 'editor.autoSaveMode':
      return <AutoSaveModeControl scope={scope} />

    case 'editor.autoSaveDelayMs':
      return <AutoSaveDelayControl scope={scope} />

    case 'lsp.enabled':
      return <LanguageServerEnabledControl scope={scope} />

    case 'lsp.servers':
      return <LanguageServerChoicesControl scope={scope} />

    case 'files.viewMode':
      return <FilesViewModeControl scope={scope} />

    case 'terminal.fontSize':
      return <TerminalFontSizeControl scope={scope} />

    case 'terminal.scrollback':
      return <TerminalScrollbackControl scope={scope} />

    case 'appearance.theme':
      return <AppearanceThemeControl scope={scope} />

    case 'mcp.enabled':
      return <McpEnabledControl scope={scope} />

    case 'mcp.servers':
      return <McpConnectionChoicesControl scope={scope} />

    default:
      /*
        目録に項目を足して、ここへの分岐を書き忘れた場合。
        黙って空の行を出すと「操作 UI が出ないだけの設定」ができるので、
        画面に出す（テストでは目録と分岐の対応を確かめている）。
      */
      return <span className="fx-settings__missing">{t('settings.missingControl')}</span>
  }
}

/* ------------------------------------------------------------- General */

function LanguageControl({ scope }: ScopeProps): JSX.Element {
  const { t } = useI18n()
  // 読み込みが返る前は、Preload が当てた表示言語を出す（LanguageProvider と同じ）。
  const { value, setLanguage } = useScopedSetters(
    { ...LANGUAGE_SETTINGS_BINDING, initial: { language: readDocumentLanguage() } },
    scope,
    createLanguageSetters
  )
  const language = value.language

  return (
    <div
      className="fx-settings__choices"
      role="radiogroup"
      aria-label={t('settings.controls.language.aria')}
      data-testid="settings-general-language"
    >
      {LANGUAGE_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          className="fx-settings__choice"
          data-testid={`settings-general-language-${choice}`}
          data-active={choice === language}
          aria-checked={choice === language}
          onClick={() => setLanguage(choice)}
        >
          {t(`language.${choice}`)}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------- Editor */

/**
 * Auto Save の方式（Session 3-5 の4つ。Session 4-3B で Editor の工具列から移した）。
 *
 * 値も setter も既存のまま（`useEditorSession`）── 移ったのは並べる場所だけで、
 * 保存されるものも、その設定でどう動くかも変わっていない。
 */
function AutoSaveModeControl({ scope }: ScopeProps): JSX.Element {
  const { value: autoSave, setAutoSaveMode } = useScopedSetters(
    AUTO_SAVE_SETTINGS_BINDING,
    scope,
    createAutoSaveSetters
  )
  const { t } = useI18n()

  return (
    <select
      className="fx-settings__select"
      aria-label={t('settings.controls.autoSaveMode.aria')}
      data-testid="settings-editor-auto-save-mode"
      value={autoSave.mode}
      onChange={(event) => setAutoSaveMode(event.target.value as AutoSaveMode)}
    >
      {AUTO_SAVE_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {t(autoSaveModeLabelKey(mode))}
        </option>
      ))}
    </select>
  )
}

/**
 * Auto Save の待ち時間（Session 4-3B で初めて操作できるようになった）。
 *
 * ## 方式が `afterDelay` でなくても出す
 *
 * 効いていないときに隠したり押せなくしたりしない。待ち時間は**方式を切り替えても
 * 持ち回す**値で（editor/autoSave.ts）、隠すと「戻したときに何秒だったか」が
 * 確かめられなくなる。効いていないことは説明文が言う。
 *
 * ## 上下限は Renderer だけを信じない
 *
 * 欄が通すのは `normalizeAutoSaveSettings`（保存の読み込みと同じ関数）で、
 * 200〜60000ms へ丸める。Main 側は「数として読めるか」までを見て、
 * 意味（範囲）は見ない ── 二重に解釈すると「どちらの判断が正しいか」が
 * 生まれる（ARCHITECTURE.md §12.4）。
 */
function AutoSaveDelayControl({ scope }: ScopeProps): JSX.Element {
  const { value: autoSave, setAutoSaveDelayMs } = useScopedSetters(
    AUTO_SAVE_SETTINGS_BINDING,
    scope,
    createAutoSaveSetters
  )
  const { t } = useI18n()

  return (
    <NumberField
      label={t('settings.controls.autoSaveDelay.label')}
      unit="ms"
      value={autoSave.delayMs}
      min={AUTO_SAVE_DELAY_MIN_MS}
      max={AUTO_SAVE_DELAY_MAX_MS}
      step={100}
      clamp={(value) => normalizeAutoSaveSettings({ ...autoSave, delayMs: value }).delayMs}
      onCommit={setAutoSaveDelayMs}
      hint={
        autoSave.mode === 'afterDelay'
          ? t('settings.controls.autoSaveDelay.hintActive', {
              min: AUTO_SAVE_DELAY_MIN_MS,
              max: AUTO_SAVE_DELAY_MAX_MS
            })
          : t('settings.controls.autoSaveDelay.hintInactive', {
              min: AUTO_SAVE_DELAY_MIN_MS,
              max: AUTO_SAVE_DELAY_MAX_MS
            })
      }
      testId="settings-editor-auto-save-delay"
    />
  )
}

/* ----------------------------------------------------------------- LSP */

/**
 * Language Server を使うか（Session 5-4）。
 *
 * ## 並べる（select にしない）
 *
 * Theme と同じ形にしてある ── 選択肢が2つしかなく、今どちらかが
 * 開いた瞬間に見える必要がある。
 *
 * ## 押した瞬間に効く
 *
 * 「適用」も「再起動してください」も無い。切れば動いているサーバがその場で
 * 終わり、指摘は Monaco 内蔵のものへ戻る。戻せば開いている文書が
 * もう一度サーバへ渡り、指摘が返ってくる ── **どちらも Main が
 * 保存に気づいて行う**（main/lsp/languageServerSettings.ts）。
 *
 * ここから IPC でサーバを操作することはしない（lsp/LspSettingsProvider.tsx）。
 */
function LanguageServerEnabledControl({ scope }: ScopeProps): JSX.Element {
  const { value: preferences, setEnabled } = useScopedSetters(
    LSP_SETTINGS_BINDING,
    scope,
    createLanguageServerSetters
  )
  const { t } = useI18n()

  return (
    <div
      className="fx-settings__choices"
      role="radiogroup"
      aria-label={t('settings.controls.lspEnabled.aria')}
      data-testid="settings-lsp-enabled"
    >
      {LSP_ENABLED_CHOICES.map((choice) => (
        <button
          key={String(choice)}
          type="button"
          role="radio"
          className="fx-settings__choice"
          data-testid={`settings-lsp-enabled-${choice ? 'on' : 'off'}`}
          data-active={choice === preferences.enabled}
          aria-checked={choice === preferences.enabled}
          onClick={() => setEnabled(choice)}
        >
          {t(choice ? 'settings.values.lsp.on' : 'settings.values.lsp.off')}
        </button>
      ))}
    </div>
  )
}

/** 並べる順（使う → 使わない）。Theme と同じく「既定の方」を先に置く。 */
const LSP_ENABLED_CHOICES: readonly boolean[] = [true, false]

/**
 * 言語ごとに使うか（Session 5-4）。
 *
 * ## 3つを1行にまとめる
 *
 * 言語ごとに設定の行を分けない ── 分けると、Language Server を1つも
 * 使っていない人にも3行が並ぶことになる。**同じ性格の切り替えが3つ**なので、
 * 1つの行の中に並べた方が「どれとどれがあるか」が一度で見える。
 *
 * ## 全体が OFF でも押せる
 *
 * 効いていないときに隠したり押せなくしたりしない（Auto Save の待ち時間と
 * 同じ扱い）── 全体を戻したときにどれが有効だったかを、戻す前に
 * 確かめられなくなるため。効いていないことは説明文が言う。
 *
 * ## この PC に入っているかは出さない
 *
 * ここに出るのは「使う設定になっているか」だけで、入っているかどうかは出ない
 * ── それはステータスバーの持ち物にあたる（lsp/LanguageServerStatusItem.tsx）。
 * 設定は使う意思で、状態は実際に動いているかで、混ぜると
 * 「入れていないのに ON になっている」が誤りに見えてしまう。
 */
function LanguageServerChoicesControl({ scope }: ScopeProps): JSX.Element {
  const { value: preferences, setServerEnabled } = useScopedSetters(
    LSP_SETTINGS_BINDING,
    scope,
    createLanguageServerSetters
  )
  const { t } = useI18n()

  return (
    <div
      className="fx-settings__choices"
      role="group"
      aria-label={t('settings.controls.lspServers.aria')}
      data-testid="settings-lsp-servers"
      data-inactive={!preferences.enabled}
    >
      {LANGUAGE_SERVER_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className="fx-settings__choice"
          data-testid={`settings-lsp-server-${id}`}
          data-active={preferences.servers[id]}
          aria-pressed={preferences.servers[id]}
          onClick={() => setServerEnabled(id, !preferences.servers[id])}
        >
          {t(languageServerNameKey(id))}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- MCP */

/**
 * MCP 連携を使うか（§21.9）。
 *
 * 並べる順を **「使わない → 使う」** にしてある ── Theme・LSP は
 * 「既定の方を先に」で揃えてあり、ここの既定は**無効**にほかならない
 * （shared/mcp/settings.ts）。外部サービスへ繋ぐ設定で、
 * 押しやすい側に「使う」を置かない。
 */
function McpEnabledControl({ scope }: ScopeProps): JSX.Element {
  const { value: preferences, setEnabled } = useScopedSetters(
    MCP_SETTINGS_BINDING,
    scope,
    createMcpSetters
  )
  const { t } = useI18n()

  return (
    <div
      className="fx-settings__choices"
      role="radiogroup"
      aria-label={t('settings.controls.mcpEnabled.aria')}
      data-testid="settings-mcp-enabled"
    >
      {MCP_ENABLED_CHOICES.map((choice) => (
        <button
          key={String(choice)}
          type="button"
          role="radio"
          className="fx-settings__choice"
          data-testid={`settings-mcp-enabled-${choice ? 'on' : 'off'}`}
          data-active={choice === preferences.enabled}
          aria-checked={choice === preferences.enabled}
          onClick={() => setEnabled(choice)}
        >
          {t(choice ? 'settings.values.mcp.on' : 'settings.values.mcp.off')}
        </button>
      ))}
    </div>
  )
}

/** 並べる順（使わない → 使う）。既定の方を先に置く。 */
const MCP_ENABLED_CHOICES: readonly boolean[] = [false, true]

/**
 * 接続ごとに使うか（§21.9）。
 *
 * LSP の言語ごとの切り替えとまったく同じ形にしてある ── 同じ性格の
 * 切り替えを1行にまとめ、**全体が OFF でも押せる**ままにする
 * （全体を戻したときに、どれを使っていたかを確かめられなくなるため）。
 */
function McpConnectionChoicesControl({ scope }: ScopeProps): JSX.Element {
  const { value: preferences, setConnectionEnabled } = useScopedSetters(
    MCP_SETTINGS_BINDING,
    scope,
    createMcpSetters
  )
  const { t } = useI18n()

  return (
    <div
      className="fx-settings__choices"
      role="group"
      aria-label={t('settings.controls.mcpServers.aria')}
      data-testid="settings-mcp-servers"
      data-inactive={!preferences.enabled}
    >
      {MCP_CONNECTION_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className="fx-settings__choice"
          data-testid={`settings-mcp-server-${id}`}
          data-active={preferences.servers[id]}
          aria-pressed={preferences.servers[id]}
          onClick={() => setConnectionEnabled(id, !preferences.servers[id])}
        >
          {t(`settings.mcp.connections.${id}`)}
        </button>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- Files */

/**
 * Files の表示方式（Session 3-6-7 の選択。ツールバーにも残っている）。
 *
 * 値の正本は `FilesViewProvider` の1つだけで、ここもツールバーも同じ
 * `setPreference` を通る ── **どちらで変えても、その場でもう片方に出る。**
 * ここで変えれば開いている Files パネルがすぐ切り替わり、ツールバーで変えれば
 * 次に Settings を開いたときに現在値としてそれが出る。
 *
 * ツールバーは2つのボタン（押し方で `auto` へ戻す）だが、ここは3つ並べる ──
 * 理由は filesSettings.ts の `FilesViewChoice`。
 */
function FilesViewModeControl({ scope }: ScopeProps): JSX.Element {
  const { value, setPreference } = useScopedSetters(
    FILES_VIEW_SETTINGS_BINDING,
    scope,
    createFilesViewSetters
  )
  const preference = value.preference
  const { t } = useI18n()
  const current = toFilesViewChoice(preference)

  return (
    <div
      className="fx-settings__choices"
      role="radiogroup"
      aria-label={t('settings.controls.filesViewMode.aria')}
      data-testid="settings-files-view-mode"
    >
      {FILES_VIEW_CHOICES.map((choice: FilesViewChoice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          className="fx-settings__choice"
          data-testid={`settings-files-view-${choice}`}
          data-active={choice === current}
          aria-checked={choice === current}
          onClick={() => setPreference(fromFilesViewChoice(choice))}
        >
          {t(filesViewChoiceLabelKey(choice))}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ Terminal */

/**
 * Terminal の文字の大きさ（Terminal のタブ列の ⚙ にも同じものがある）。
 *
 * 2箇所に置いたままにした理由は TerminalSettingsMenu.tsx ── 見ながら合わせる値で、
 * そのたびに画面全体を覆う面を開くのは遠い。**値は1つ**で、どちらも
 * `useTerminalSettings` の `setFontSize` を通る（打鍵の Ctrl + ＋ / － も同じ）。
 */
function TerminalFontSizeControl({ scope }: ScopeProps): JSX.Element {
  const { value: display, setFontSize } = useScopedSetters(
    TERMINAL_DISPLAY_SETTINGS_BINDING,
    scope,
    createTerminalDisplaySetters
  )
  const { t } = useI18n()

  return (
    <NumberField
      label={t('settings.controls.terminalFontSize.label')}
      unit={t('settings.controls.terminalFontSize.unit')}
      value={display.fontSize}
      min={TERMINAL_FONT_SIZE_MIN}
      max={TERMINAL_FONT_SIZE_MAX}
      step={1}
      clamp={clampTerminalFontSize}
      onCommit={setFontSize}
      testId="settings-terminal-font-size"
    />
  )
}

/**
 * さかのぼれる行数（Session 4-3B で Terminal の ⚙ からここへ移した）。
 *
 * 移した理由は TerminalSettingsMenu.tsx ── 端末を見ながら決める値ではなく、
 * 一度決めたら滅多に触らない。同じ設定を変える口を2つ残さない。
 */
function TerminalScrollbackControl({ scope }: ScopeProps): JSX.Element {
  const { value: display, setScrollback } = useScopedSetters(
    TERMINAL_DISPLAY_SETTINGS_BINDING,
    scope,
    createTerminalDisplaySetters
  )
  const { t } = useI18n()

  return (
    <NumberField
      label={t('settings.controls.terminalScrollback.label')}
      unit={t('settings.controls.terminalScrollback.unit')}
      value={display.scrollback}
      min={TERMINAL_SCROLLBACK_MIN}
      max={TERMINAL_SCROLLBACK_MAX}
      step={500}
      clamp={clampTerminalScrollback}
      onCommit={setScrollback}
      testId="settings-terminal-scrollback"
    />
  )
}

/* ---------------------------------------------------------- Appearance */

/**
 * Theme（Session 4-4）。
 *
 * ## 選択肢を並べる（select にしない）
 *
 * Files の表示方式と同じ形にしてある。**今どちらになっているかが、開いた瞬間に
 * 見える**ことが要点で、`select` だと畳まれた1行になり、もう片方があることが
 * 見えない。選択肢が2つしかないので、並べても場所を取らない。
 *
 * ## 押した瞬間に切り替わる
 *
 * 「適用」も「OK」も無い。**Theme は結果を見て決めるもの**にほかならず、
 * 確定するまで見えないと選べない ── Files の表示方式・Terminal の文字の
 * 大きさと同じ扱いで、この面の他の項目もすべて同じ（値を持たない面なので、
 * 確定という段階が1つも無い）。
 *
 * ## 値も setter も既存のまま
 *
 * 正本は `theme/useAppearance.ts` で、ここは読んで返すだけ ── この面が
 * 値を1つも持たないのは Session 4-3B からの前提で、Theme も例外にしない。
 * CSS も Monaco も xterm も、この setter を通った結果として切り替わる。
 */
function AppearanceThemeControl({ scope }: ScopeProps): JSX.Element {
  /*
    読み込みが返る前は、Preload が当てた Theme を出す（useAppearance.ts と同じ）。
    既定（Dark）を出すと、Light の人には一瞬違う方が選ばれて見える。
  */
  const { value: settings, setTheme } = useScopedSetters(
    { ...APPEARANCE_SETTINGS_BINDING, initial: { theme: readDocumentTheme() } },
    scope,
    createAppearanceSetters
  )
  const { t } = useI18n()

  return (
    <div
      className="fx-settings__choices"
      role="radiogroup"
      aria-label={t('settings.controls.theme.aria')}
      data-testid="settings-appearance-theme"
    >
      {APPEARANCE_THEME_CHOICES.map((theme) => (
        <button
          key={theme}
          type="button"
          role="radio"
          className="fx-settings__choice"
          data-testid={`settings-appearance-theme-${theme}`}
          data-active={theme === settings.theme}
          aria-checked={theme === settings.theme}
          onClick={() => setTheme(theme)}
        >
          {t(themeLabelKey(theme))}
        </button>
      ))}
    </div>
  )
}

function autoSaveModeLabelKey(mode: AutoSaveMode): TranslationKey {
  return `settings.values.autoSave.${mode}`
}

function filesViewChoiceLabelKey(choice: FilesViewChoice): TranslationKey {
  return `settings.values.filesView.${choice}`
}

function themeLabelKey(theme: (typeof APPEARANCE_THEME_CHOICES)[number]): TranslationKey {
  return `settings.values.theme.${theme}`
}
