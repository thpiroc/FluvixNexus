import { describe, expect, it } from 'vitest'
import { emptySettingsSections, type SettingsSections } from '@shared/settings'
import { fromThemeArguments, THEME_IDS, toThemeArgument, type ThemeId } from '@shared/theme'
import {
  AUTO_SAVE_DELAY_MAX_MS,
  AUTO_SAVE_DELAY_MIN_MS,
  DEFAULT_AUTO_SAVE_SETTINGS,
  normalizeAutoSaveSettings,
  toAutoSaveSettings,
  toEditorSettingsSection,
  type AutoSaveMode,
  type AutoSaveSettings
} from '../editor/autoSave'
import {
  chooseLayoutMode,
  DEFAULT_FILES_COLUMN_WIDTH,
  FILES_COLUMN_WIDTH_MAX
} from '../files/filesLayoutMode'
import {
  clampColumnWidth,
  DEFAULT_FILES_VIEW_SETTINGS,
  fromFilesViewChoice,
  toFilesSettingsSection,
  toFilesViewChoice,
  toFilesViewSettings,
  type FilesViewChoice,
  type FilesViewSettings
} from '../files/filesSettings'
import {
  clampTerminalFontSize,
  clampTerminalScrollback,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN
} from '../terminal/terminalDisplay'
import {
  DEFAULT_TERMINAL_DISPLAY_SETTINGS,
  toTerminalDisplaySettings,
  toTerminalSettingsSection,
  type TerminalDisplaySettings
} from '../terminal/terminalSettings'
import {
  APPEARANCE_THEME_CHOICES,
  DEFAULT_APPEARANCE_SETTINGS,
  toAppearanceSection,
  toAppearanceSettings,
  type AppearanceSettings
} from '../theme/appearanceSettings'
import { listSettingsItems } from './settingsCatalog'

/**
 * Settings 画面（Session 4-3B）の統合テスト。
 *
 * 個々の層の単体テストは各ディレクトリの隣にある（`autoSave.test.ts` ・
 * `filesSettings.test.ts` ・`terminalSettings.test.ts` ・`settingsSections.test.ts`）。
 * ここで確かめるのはその先で、**Settings 画面から値を変えたときに、
 * 既存 UI と同じ1つの値を通り、ディスクの形と往復し、開き直しても戻ること**を見る。
 *
 * 実際の使い方はこの順に起きる。
 *
 *   既定で始まる → Settings で変える → 面を閉じて開き直す → 現在値が出る
 *                → 既存 UI で変える → Settings に現在値が出る
 *                → アプリを再起動 → 復元される
 *
 * ## React も DOM も出てこない
 *
 * 対象は Electron にも React にも DOM にも依存しない部分（値のモデルと保存形式の
 * 往復）。描画と打鍵は実機での確認に任せる（docs/DEVELOPMENT.md §4）── この分担は
 * `workspace/workspace.integration.test.ts` と同じにしてある。
 *
 * ## 「二重に持っていない」をどう確かめるか
 *
 * Settings 画面は値を1つも持たない（settings/SettingsOverlay.tsx）。それを
 * テストから見える形にしたのが、下の `Store` にほかならない ── **値は1箇所**で、
 * Settings 画面からの操作も既存 UI からの操作も**同じ setter を通す**。
 * 片方だけが更新される作りだったなら、同じ `Store` を読む2つの読み出しが
 * 食い違うことになる。
 *
 * ## Main 側はここから参照しない
 *
 * 層の分離のため、「再起動」は JSON の往復として表す
 * （`workspace.integration.test.ts` と同じ）。Main が見る形の検証は
 * `src/main/store/settingsDocument.test.ts` と `settingsSections.test.ts` が持つ。
 */

/* -------------------------------------------------------------------------- */
/* 値の持ち主（実物の Context / hook の代わり）                                 */
/* -------------------------------------------------------------------------- */

/**
 * 3つの値の持ち主をまとめた入れ物。
 *
 * 実物では `useEditorSession` ・`FilesViewProvider` ・`useTerminalSettings` の
 * 3つに分かれているが、どれも「1つの値と、それを変える setter」でしかない。
 * ここでは同じ形を1つにまとめて持ち、**Settings 画面と既存 UI の両方が
 * 同じ setter を呼ぶ**ことを見えるようにする。
 */
class Store {
  autoSave: AutoSaveSettings = DEFAULT_AUTO_SAVE_SETTINGS
  files: FilesViewSettings = DEFAULT_FILES_VIEW_SETTINGS
  terminal: TerminalDisplaySettings = DEFAULT_TERMINAL_DISPLAY_SETTINGS
  appearance: AppearanceSettings = DEFAULT_APPEARANCE_SETTINGS

  /* -------- setter（実物と同じ正規化を通る） */

  setAutoSaveMode(mode: AutoSaveMode): void {
    this.autoSave = normalizeAutoSaveSettings({ ...this.autoSave, mode })
  }

  setAutoSaveDelayMs(delayMs: number): void {
    this.autoSave = normalizeAutoSaveSettings({ ...this.autoSave, delayMs })
  }

  setFilesPreference(preference: FilesViewSettings['preference']): void {
    this.files = { ...this.files, preference }
  }

  setColumnWidth(width: number): void {
    this.files = { ...this.files, columnWidth: clampColumnWidth(width) }
  }

  setFontSize(fontSize: number): void {
    this.terminal = { ...this.terminal, fontSize: clampTerminalFontSize(fontSize) }
  }

  setScrollback(scrollback: number): void {
    this.terminal = { ...this.terminal, scrollback: clampTerminalScrollback(scrollback) }
  }

  /*
    Theme（Session 4-4）。実物は `useAppearance` で、他の3つと同じく
    「1つの値と、それを変える setter」でしかない。
  */
  setTheme(theme: string): void {
    this.appearance = toAppearanceSettings({ theme })
  }

  /* -------- ディスクへ（useSettingsSection が値の変化ごとに書くもの） */

  toSections(): SettingsSections {
    return {
      editor: toEditorSettingsSection(this.autoSave),
      files: toFilesSettingsSection(this.files),
      terminal: toTerminalSettingsSection(this.terminal),
      appearance: toAppearanceSection(this.appearance)
    }
  }

  /* -------- ディスクから（起動時に1度だけ読むもの） */

  loadSections(sections: SettingsSections): void {
    this.autoSave = toAutoSaveSettings(sections.editor)
    this.files = toFilesViewSettings(sections.files)
    this.terminal = toTerminalDisplaySettings(sections.terminal)
    this.appearance = toAppearanceSettings(sections.appearance)
  }
}

/**
 * アプリを閉じて開き直す。
 *
 * ディスクを通るので JSON にできるものしか残らない（実物と同じ制約）。
 * Main の検証はここでは通さない ── 層の分離のため（このファイルの冒頭）。
 */
function restart(store: Store): Store {
  const written = JSON.parse(JSON.stringify(store.toSections())) as SettingsSections
  const next = new Store()

  next.loadSections(written)

  return next
}

/* -------------------------------------------------------------------------- */
/* Settings 画面から読む値（面を開いたときに出る現在値）                          */
/* -------------------------------------------------------------------------- */

/**
 * Settings 画面が今出す値。
 *
 * **画面は値を持たない**ので、開くたびにこの形で持ち主から読み直すことになる
 * （＝面を閉じて開き直すことは、この関数をもう一度呼ぶことにほかならない）。
 */
function readSettingsScreen(store: Store): {
  autoSaveMode: AutoSaveMode
  autoSaveDelayMs: number
  filesViewChoice: FilesViewChoice
  terminalFontSize: number
  terminalScrollback: number
  theme: ThemeId
} {
  return {
    autoSaveMode: store.autoSave.mode,
    autoSaveDelayMs: store.autoSave.delayMs,
    filesViewChoice: toFilesViewChoice(store.files.preference),
    terminalFontSize: store.terminal.fontSize,
    terminalScrollback: store.terminal.scrollback,
    theme: store.appearance.theme
  }
}

/* -------------------------------------------------------------------------- */

describe('Settings 画面の既定', () => {
  it('保存が1つも無ければ、6項目すべてが既定で出る', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    expect(readSettingsScreen(store)).toEqual({
      autoSaveMode: 'off',
      autoSaveDelayMs: 1000,
      filesViewChoice: 'auto',
      terminalFontSize: 13,
      terminalScrollback: 5000,
      theme: 'dark'
    })
  })

  /* 画面に並ぶ6項目と、この統合テストが触る6項目が食い違わないようにする。 */
  it('画面に並ぶ項目と、ここで確かめる項目が一致する', () => {
    expect(listSettingsItems().map((item) => item.id)).toEqual([
      'editor.autoSaveMode',
      'editor.autoSaveDelayMs',
      'files.viewMode',
      'terminal.fontSize',
      'terminal.scrollback',
      'appearance.theme'
    ])
  })
})

describe('Settings 画面から6項目を変える', () => {
  it('変えた値が、閉じて開き直しても、再起動しても残る', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    // Settings 画面での操作（どれも既存の setter を通る）。
    store.setAutoSaveMode('afterDelay')
    store.setAutoSaveDelayMs(2500)
    store.setFilesPreference(fromFilesViewChoice('columns'))
    store.setFontSize(16)
    store.setScrollback(12_000)
    store.setTheme('light')

    const opened = readSettingsScreen(store)

    expect(opened).toEqual({
      autoSaveMode: 'afterDelay',
      autoSaveDelayMs: 2500,
      filesViewChoice: 'columns',
      terminalFontSize: 16,
      terminalScrollback: 12_000,
      theme: 'light'
    })

    // 面を閉じて開き直す（画面は値を持たないので、読み直すだけで同じ）。
    expect(readSettingsScreen(store)).toEqual(opened)

    // アプリを再起動する。
    expect(readSettingsScreen(restart(store))).toEqual(opened)
  })

  it('1項目だけ変えても、他の5項目を巻き込まない', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    store.setAutoSaveMode('onWindowChange')
    store.setAutoSaveDelayMs(400)
    store.setFilesPreference(fromFilesViewChoice('tree'))
    store.setFontSize(20)
    store.setScrollback(800)
    store.setTheme('light')

    const before = readSettingsScreen(store)

    store.setScrollback(9000)

    expect(readSettingsScreen(store)).toEqual({ ...before, terminalScrollback: 9000 })
  })

  /*
    Theme を切り替えても、他の設定は1つも動かない（Session 4-4）。
    見た目に関わる設定が増えた以上、「Light にしたら Files がツリーに戻った」
    のような巻き込みが起きていないことを、ここでも見ておく。
  */
  it('Theme を往復させても、他の5項目は動かない', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    store.setAutoSaveDelayMs(3000)
    store.setFilesPreference(fromFilesViewChoice('columns'))
    store.setFontSize(17)

    const before = readSettingsScreen(store)

    store.setTheme('light')
    store.setTheme('dark')

    expect(readSettingsScreen(store)).toEqual(before)
  })

  /*
    方式を切り替えても待ち時間は持ち回す（editor/autoSave.ts）。
    Settings 画面で初めて待ち時間を操作できるようになったので、
    「切り替えて戻したら既定に化けていた」が起きないことをここでも見る。
  */
  it('自動保存の方式を切り替えても、待ち時間は保たれる', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    store.setAutoSaveDelayMs(3000)
    store.setAutoSaveMode('afterDelay')
    store.setAutoSaveMode('off')
    store.setAutoSaveMode('afterDelay')

    expect(store.autoSave.delayMs).toBe(3000)
    expect(readSettingsScreen(restart(store)).autoSaveDelayMs).toBe(3000)
  })
})

describe('既存 UI と Settings 画面の同期', () => {
  /*
    Files の表示方式は Files のツールバーにも残っている（FilesExplorer.tsx）。
    ツールバーは `chooseLayoutMode` を、Settings は `fromFilesViewChoice` を呼ぶが、
    **行き着く値は同じ**でなければならない。
  */
  it('Files の表示方式は、ツールバーから変えても Settings から変えても同じ値になる', () => {
    const fromToolbar = new Store()
    const fromSettings = new Store()

    fromToolbar.loadSections(emptySettingsSections())
    fromSettings.loadSections(emptySettingsSections())

    fromToolbar.setFilesPreference(chooseLayoutMode('columns'))
    fromSettings.setFilesPreference(fromFilesViewChoice('columns'))

    expect(fromToolbar.files).toEqual(fromSettings.files)
    expect(fromToolbar.toSections()).toEqual(fromSettings.toSections())
  })

  it('ツールバーで変えた後に Settings を開くと、その値が現在値として出る', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    // ツールバー: カラムを選ぶ。
    store.setFilesPreference(chooseLayoutMode('columns'))
    expect(readSettingsScreen(store).filesViewChoice).toBe('columns')

    // ツールバー: 出ている方をもう一度押して「パネルの形に任せる」へ戻す。
    store.setFilesPreference({ kind: 'auto' })
    expect(readSettingsScreen(store).filesViewChoice).toBe('auto')
  })

  it('Settings で変えた表示方式は、Files パネルが読む値そのものが変わる', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    store.setFilesPreference(fromFilesViewChoice('tree'))

    // Files パネル（useFilesLayout）が読むのは、この preference 1つだけ。
    expect(store.files.preference).toEqual({ kind: 'explicit', mode: 'tree' })
  })

  /*
    Terminal の文字の大きさは、タブ列の ⚙ にも残っている（TerminalSettingsMenu.tsx）。
    どちらも `setFontSize` を通るので、値は1つしかない。
  */
  it('Terminal の文字の大きさは、⚙ から変えても Settings から変えても同じ値になる', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    // ⚙ から。
    store.setFontSize(18)
    expect(readSettingsScreen(store).terminalFontSize).toBe(18)

    // Settings から。
    store.setFontSize(11)
    expect(store.terminal.fontSize).toBe(11)
  })

  /*
    カラムの幅は Settings 画面に載せていない（settingsCatalog.ts）。
    載せていないだけで**保存基盤の上では今までどおり持ち続ける**ので、
    Settings から表示方式を変えても幅が消えないことを見る。
  */
  it('Settings で表示方式を変えても、カラムの幅は失われない', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    // FileColumns.tsx の直接操作（Settings 画面には無い）。
    store.setColumnWidth(320)

    store.setFilesPreference(fromFilesViewChoice('tree'))
    store.setFilesPreference(fromFilesViewChoice('columns'))

    expect(store.files.columnWidth).toBe(320)
    expect(restart(store).files.columnWidth).toBe(320)
  })
})

describe('Settings 画面から入る値の正規化', () => {
  /*
    Settings 画面の欄は、保存の読み込みと**同じ関数**を通す。
    片方だけに掛けると「欄からは入らないのに保存ファイルを直接書けば通る」が生まれる。
  */
  it('自動保存の待ち時間は上下限へ丸まる', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    store.setAutoSaveDelayMs(0)
    expect(store.autoSave.delayMs).toBe(AUTO_SAVE_DELAY_MIN_MS)

    store.setAutoSaveDelayMs(999_999)
    expect(store.autoSave.delayMs).toBe(AUTO_SAVE_DELAY_MAX_MS)

    store.setAutoSaveDelayMs(1234.6)
    expect(store.autoSave.delayMs).toBe(1235)
  })

  it('Terminal の文字の大きさとさかのぼれる行数も上下限へ丸まる', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    store.setFontSize(1)
    expect(store.terminal.fontSize).toBe(TERMINAL_FONT_SIZE_MIN)

    store.setFontSize(200)
    expect(store.terminal.fontSize).toBe(TERMINAL_FONT_SIZE_MAX)

    store.setScrollback(1)
    expect(store.terminal.scrollback).toBe(TERMINAL_SCROLLBACK_MIN)

    store.setScrollback(10_000_000)
    expect(store.terminal.scrollback).toBe(TERMINAL_SCROLLBACK_MAX)
  })

  /* 丸めた後の値がディスクへ行く（範囲の外の値を残さない）。 */
  it('丸めた結果がそのまま保存される', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    store.setAutoSaveDelayMs(-5)
    store.setFontSize(999)
    store.setScrollback(0)
    store.setColumnWidth(99_999)

    expect(store.toSections()).toEqual({
      editor: { autoSaveMode: 'off', autoSaveDelayMs: AUTO_SAVE_DELAY_MIN_MS },
      files: { viewMode: 'auto', columnWidth: FILES_COLUMN_WIDTH_MAX },
      terminal: { fontSize: TERMINAL_FONT_SIZE_MAX, scrollback: TERMINAL_SCROLLBACK_MIN },
      appearance: { theme: 'dark' }
    })
  })

  /*
    知らない Theme 名は**書く前にも落とす**（appearanceSettings.ts）。
    読むときだけ落とす形にすると、次に読む側が必ずいることを当てにすることになる。
  */
  it('知らない Theme 名はディスクへ残らない', () => {
    const store = new Store()
    store.loadSections(emptySettingsSections())

    store.setTheme('solarized')

    expect(store.appearance.theme).toBe('dark')
    expect(store.toSections().appearance).toEqual({ theme: 'dark' })
  })

  /*
    アプリをダウングレードした場合（後の版が足した方式が保存されている）。
    Settings 画面はそれを「知らない値」として既定へ落とす ── 画面が
    どれも選ばれていない状態になるのを避けるため。
  */
  it('知らない値が保存されていても、Settings 画面は既定を出す', () => {
    const store = new Store()

    store.loadSections({
      editor: { autoSaveMode: 'onEveryKeystroke', autoSaveDelayMs: 1500 },
      files: { viewMode: 'gallery', columnWidth: DEFAULT_FILES_COLUMN_WIDTH },
      terminal: { fontSize: 15, scrollback: 5000 },
      appearance: { theme: 'solarized' }
    })

    expect(readSettingsScreen(store)).toEqual({
      autoSaveMode: 'off',
      // 方式だけが読めなかった場合も、待ち時間は落とさない（key ごとに独立）。
      autoSaveDelayMs: 1500,
      filesViewChoice: 'auto',
      terminalFontSize: 15,
      terminalScrollback: 5000,
      // 知らない Theme 名は Dark へ（無色の画面より、既定の見た目で始める）。
      theme: 'dark'
    })
  })
})

describe('Theme（Session 4-4）', () => {
  /*
    起動時のちらつきを消す仕組みが**同じ落とし先を通ること**を見る。

    Main（窓の初期色）・Preload（`<html>` への属性）・Renderer（値の持ち主）は
    どれも `normalizeThemeId` を通る。ここが食い違うと、「起動直後は Dark、
    読み込み後に Light」という一瞬が戻ってくる。
  */
  it('保存されている値・引数・実行時の値が、同じ落とし先を通る', () => {
    for (const stored of ['light', 'dark', 'solarized', '', undefined, null, 3, {}]) {
      const fromDisk = toAppearanceSettings({ theme: stored as string | undefined }).theme
      const fromArgument = fromThemeArguments([toThemeArgument(fromDisk)])

      expect(fromArgument).toBe(fromDisk)
      expect(THEME_IDS).toContain(fromDisk)
    }
  })

  it('引数が無ければ Dark（Preload が渡されなかった場合）', () => {
    expect(fromThemeArguments([])).toBe('dark')
    expect(fromThemeArguments(['--other=light'])).toBe('dark')
  })

  it('選べるのは Dark と Light の2つだけ', () => {
    expect(APPEARANCE_THEME_CHOICES).toEqual(['dark', 'light'])
  })
})

describe('表示方式の選択肢（Settings 画面の3つ）', () => {
  it('3つとも往復して同じものへ戻る', () => {
    for (const choice of ['auto', 'tree', 'columns'] as const) {
      expect(toFilesViewChoice(fromFilesViewChoice(choice))).toBe(choice)
    }
  })
})
