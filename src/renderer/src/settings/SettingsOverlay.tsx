import { useEffect, useState, type JSX } from 'react'
import {
  AUTO_SAVE_DELAY_MAX_MS,
  AUTO_SAVE_DELAY_MIN_MS,
  AUTO_SAVE_MODES,
  normalizeAutoSaveSettings,
  type AutoSaveMode
} from '../editor/autoSave'
import { useEditorContext } from '../editor/context'
import {
  FILES_VIEW_CHOICES,
  fromFilesViewChoice,
  toFilesViewChoice,
  type FilesViewChoice
} from '../files/filesSettings'
import { useFilesViewPreference } from '../files/FilesViewProvider'
import { useI18n } from '../i18n/context'
import { LANGUAGE_CHOICES } from '../i18n/languageSettings'
import type { TranslationKey } from '../i18n/messages'
import { useTerminal } from '../terminal/context'
import { useTheme } from '../theme/context'
import { APPEARANCE_THEME_CHOICES } from '../theme/appearanceSettings'
import {
  clampTerminalFontSize,
  clampTerminalScrollback,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN
} from '../terminal/terminalDisplay'
import { NumberField } from '../ui/NumberField'
import {
  DEFAULT_SETTINGS_CATEGORY_ID,
  getSettingsCategory,
  listSettingsCategories,
  type SettingsCategoryId,
  type SettingsItemDescriptor
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
 * この面は state として**開いているカテゴリしか持たない。** 設定の値はすべて
 * 既存の Context / hook から読み、既存の setter へ返す。
 *
 * | 項目                      | 正本                                    | 既存 UI                       |
 * | ------------------------- | --------------------------------------- | ----------------------------- |
 * | Auto Save の方式・待ち時間 | `useEditorSession`（editor/context.ts） | 無し（4-3B でここへ移した）   |
 * | Files の表示方式          | `FilesViewProvider`                     | Files のツールバー（残す）    |
 * | Terminal の文字の大きさ   | `useTerminalSettings`                   | Terminal の ⚙（残す）        |
 * | Terminal のさかのぼれる行数 | `useTerminalSettings`                 | 無し（4-3B でここへ移した）   |
 * | Theme                     | `useAppearance`（theme/context.ts）     | 無し（4-4 でここが唯一の口）  |
 *
 * **同じ値を指す state をここに作らない**のが要点で、作った瞬間に
 * 「Settings で変えたのに Files パネルが変わらない」「ツールバーで変えたのに
 * Settings が古い値を出す」が生まれる。片方で変えればもう片方にもその場で出るのは、
 * 二重に持っていないからにほかならない。
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
    開いているカテゴリ。**この面が持つ唯一の state。**

    保存しないのは、Settings が「今どこを見ていたか」を覚えている必要が無いため
    ── 開くたびに Editor から始まる方が、どこを見ていたか思い出さずに済む。
  */
  const [categoryId, setCategoryId] = useState<SettingsCategoryId>(DEFAULT_SETTINGS_CATEGORY_ID)
  const category = getSettingsCategory(categoryId)

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

      <div className="fx-settings__body">
        {/*
          カテゴリの一覧。上部バーの View / Layout のようなメニューにしなかったのは、
          **今どこを見ているかが常に見えている**方がよいため ── 3つしか無いので
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

        <div className="fx-settings__content" data-category={category.id}>
          <div className="fx-settings__heading">
            <h2 className="fx-settings__heading-title">{t(category.titleKey)}</h2>
            <p className="fx-settings__heading-note">{t(category.descriptionKey)}</p>
          </div>

          {category.items.map((item) => (
            <SettingsRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 設定1つ分の行（名前・説明・操作 UI）。
 *
 * どの項目かで中身が変わる ── 目録（settingsCatalog.ts）は「何が並ぶか」までを
 * 決め、**その値をどう操作するか**はここが決める。目録に操作 UI の種類まで
 * 持たせると、React を知らないはずの目録が React の都合を持つことになる。
 */
function SettingsRow({ item }: { readonly item: SettingsItemDescriptor }): JSX.Element {
  const { t } = useI18n()

  return (
    <section className="fx-settings__row" data-item={item.id}>
      <div className="fx-settings__row-main">
        <span className="fx-settings__row-title">{t(item.titleKey)}</span>
        <p className="fx-settings__row-note">{t(item.descriptionKey)}</p>
      </div>
      <div className="fx-settings__row-control">
        <SettingsControl item={item} />
      </div>
    </section>
  )
}

function SettingsControl({ item }: { readonly item: SettingsItemDescriptor }): JSX.Element {
  const { t } = useI18n()

  switch (item.id) {
    case 'general.language':
      return <LanguageControl />

    case 'editor.autoSaveMode':
      return <AutoSaveModeControl />

    case 'editor.autoSaveDelayMs':
      return <AutoSaveDelayControl />

    case 'files.viewMode':
      return <FilesViewModeControl />

    case 'terminal.fontSize':
      return <TerminalFontSizeControl />

    case 'terminal.scrollback':
      return <TerminalScrollbackControl />

    case 'appearance.theme':
      return <AppearanceThemeControl />

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

function LanguageControl(): JSX.Element {
  const { language, setLanguage, t } = useI18n()

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
function AutoSaveModeControl(): JSX.Element {
  const { autoSave, setAutoSaveMode } = useEditorContext()
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
function AutoSaveDelayControl(): JSX.Element {
  const { autoSave, setAutoSaveDelayMs } = useEditorContext()
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
function FilesViewModeControl(): JSX.Element {
  const { preference, setPreference } = useFilesViewPreference()
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
function TerminalFontSizeControl(): JSX.Element {
  const { display, setFontSize } = useTerminal()
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
function TerminalScrollbackControl(): JSX.Element {
  const { display, setScrollback } = useTerminal()
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
function AppearanceThemeControl(): JSX.Element {
  const { settings, setTheme } = useTheme()
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
