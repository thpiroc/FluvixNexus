/**
 * Command の識別子（Session 4-7A）。
 *
 * Keyboard Shortcut 基盤は **command（何をするか）** と **shortcut（どの打鍵で呼ぶか）**
 * を分けて持つ。このファイルが持つのは前者の名前だけで、打鍵は1つも出てこない
 * （keybindings/defaults.ts）。分けておくと、
 *
 *   - 同じ command を複数の入口（打鍵・メニュー・将来の Command Palette）から呼べる
 *   - 打鍵を変えても command 側は1行も変わらない
 *   - 割り当ての無い command が「一覧に出るが打鍵は空」として自然に表せる
 *
 * となる。
 *
 * ## 閉じた集合にする
 *
 * `COMMAND_IDS` に載っているものだけが command で、任意の文字列を command として
 * 実行する経路は存在しない。これは `shared/settings/sections.ts` の section と
 * まったく同じ理由にあたる ── **任意の名前を許した時点で「アプリが決めた操作」
 * という限定が消える。** 将来 `keybindings.json` からユーザーの割り当てを読むように
 * なったとき、そこに書かれた command 名は必ず `isCommandId` を通す
 * （`workspace/panels/registry.ts` の `isPanelId`・
 * `shared/settings/sections.ts` の `isSettingsSectionId` と同じ作法）。
 *
 * **`execute(id: string)` のような汎用の入口を作らないこと。** 作った瞬間、
 * ディスクの文字列がそのまま実行対象になる。
 *
 * ## 名前の付け方
 *
 * `<領域>.<動詞>` の2段（`view.togglePanel.files` だけは対象が続く3段）。
 * 領域は `CommandCategory`（types.ts）と対応させてあり、Session 4-7B で
 * Settings の Keyboard Shortcuts 画面に並べるときの区切りになる。
 *
 * **一度決めた id は変えない。** 将来ユーザーの割り当てがディスクに残るため、
 * 名前を変えると「その人が設定した打鍵だけが静かに効かなくなる」。
 *
 * ## Session 4-7B で足したもの
 *
 * Git（`git.commit` / `git.push` …）と Files 検索（`files.search.*`）は
 * handler が panel の中（`GitView` / `FilesView` のローカル state）にあり、
 * 所有者が自分で登録する形（contribution）になる。
 *
 * **10件とも打鍵を持たない。** `keybindings/defaults.ts` は Session 4-7B で
 * 1行も変えていない ── 「割り当ての無い command」は 4-7A が既に正常な状態
 * として設計してあり（defaults.ts の「割り当ての無い command」）、将来の
 * Settings の一覧に「未割り当て」として並ぶ。打鍵を足さなかった理由は
 * 3つある。
 *
 *   1. `git.refresh` と `files.refresh` に**同じ打鍵を割り当てられない** ──
 *      「今見ているパネルを更新」が自然だが、同じ打鍵 × 重なる条件は
 *      `findKeybindingConflicts` が競合として拾う（defaults.test.ts）。
 *      避けるには `gitFocused` / `filesFocused` という条件を増やすことになり、
 *      それは `WHEN_KEYS` と `readWhenContext` の両方を広げる話になる
 *   2. `ctrl+enter` は取れない。Git の Commit 欄の `onKeyDown` は
 *      `preventDefault()` を呼ぶが `stopPropagation()` は呼ばず、
 *      KeybindingProvider は `defaultPrevented` を見ない（意図的。あちらの冒頭）
 *      ── window にも同じ打鍵が届き、2度目の `commit` は `operate` の
 *      目印で捨てられるため、**成功しても入力欄が空にならない**
 *   3. Git の操作はパネルを見ながら行うもので、しかも背面タブでは
 *      command 自体が登録されない（下記）── 打鍵で得られるものが小さい
 *
 * Terminal の文字の大きさ（Ctrl + `+` / `-` / `0`）はここには無い。既存の経路
 * （`terminal/terminalDisplay.ts` → `TerminalSurface.tsx` の `onAppKey`）を
 * 1行も変えないためで、あちらは日本語配列のための `=` / `_` の読み替えを持っている
 * ── registry へ移すなら、その読み替えごと設計し直すことになる（4-7B）。
 *
 * `Ctrl+P` / `Ctrl+Shift+P` は **Command Palette のために空けてある**。
 * ここにも defaults.ts にも現れない。
 *
 * ## 所有者がパネルの中に居るということ
 *
 * `git.*` / `files.*` の handler を持つのは Git / Files パネルの中で、
 * **前面に出ているパネルしか mount されない**
 * （`workspace/shell/PanelGroup.tsx` は `activePanelId` の Component だけを描く）。
 * したがって、
 *
 *   - 同じ command が2度登録されることが**起こりえない**（インスタンスが1つしかない）
 *   - Git が背面タブに居る間、`git.*` は登録されていない ＝ 実行できない
 *
 * となる。これは失敗ではなく「今はその操作ができない」という正しい状態で、
 * `when` に `gitPanelVisible` のような条件を足さずに済む理由でもある
 * （`keybindings/when.ts` が `gitRepositoryAvailable` を入れなかったのと同じ判断）。
 */

/**
 * 既知の command の名前。
 *
 * 並びは `CommandCategory` の順（workspace / editor / view / settings）。
 * 配列リテラルなので同じ名前を2つ書くこと自体は防げないが、
 * registry.ts の `Record<CommandId, …>` が同じ key を2度書けないため、
 * **重複した id は登録表の側で必ず潰れる**（registry.test.ts が実数で確かめる）。
 */
export const COMMAND_IDS = [
  'workspace.openFolder',
  'workspace.closeFolder',
  'editor.save',
  'editor.saveAs',
  /*
    Language Server の6操作（Session 5-12）。所有者は Monaco の器
    （editor/monaco/MonacoEditor.tsx）で、**エディタが出ている間だけ**登録される
    （editor/lsp/useEditorActionCommands.ts）。

    handler はどれも Monaco の Action を1つ叩くだけで、LSP を呼ぶ経路を
    足していない ── 定義も参照も整形も、Session 5-5 〜 5-11 で登録した
    Provider が Action の先で答える（editor/lsp/editorActions.ts）。

    Diagnostics と Document Sync はここに無い。**常に動いているもの**で、
    「実行する」という形を持たないため（打鍵で走らせる対象ではない）。
  */
  'editor.goToDefinition',
  'editor.findReferences',
  'editor.renameSymbol',
  'editor.formatDocument',
  'editor.triggerSuggest',
  'editor.showHover',
  'view.togglePanel.files',
  'view.togglePanel.editor',
  'view.togglePanel.terminal',
  'view.togglePanel.git',
  'view.togglePanel.debug',
  'view.resetLayout',
  'settings.open',
  'settings.close',
  /*
    Debug Toolbar（Session 6-11）と Debug Keybinding（Session 6-16）。
    実行制御の所有者は DebugPanel の上部 toolbar で、ボタンが押せるときだけ
    同じ command が登録される。F5 は Start / Continue を状態で切り替えるため、
    操作そのものを二重化せず `debug.startOrContinue` から既存の Start /
    Continue handler へ委ねる。

    `debug.toggleBreakpoint` の所有者は Monaco の器。現在の Editor / カーソル行を
    安全に読む必要があるため、toolbar ではなく Editor 側で登録する。
  */
  'debug.addProfile',
  'debug.editProfile',
  'debug.deleteProfile',
  'debug.startOrContinue',
  'debug.start',
  'debug.continue',
  'debug.pause',
  'debug.stepOver',
  'debug.stepInto',
  'debug.stepOut',
  'debug.stop',
  'debug.toggleBreakpoint',
  /*
    Git（Session 4-7B）。所有者は GitView の中の GitCommands で、
    **リポジトリが使える状態のときだけ**登録される（git/GitCommands.tsx）。

    `git.stashPush` だけは名前と挙動がずれている ── 繋いであるのは
    「退避の面を開く」で、退避そのものは走らない（理由は registry.ts）。
  */
  'git.refresh',
  'git.commit',
  'git.push',
  'git.pull',
  'git.fetch',
  'git.openHistory',
  'git.stashPush',
  /*
    Files（Session 4-7B）。`files.refresh` の所有者は FilesExplorer
    （ツリーの状態を持つ場所）、検索の2つは FilesView になる。
  */
  'files.refresh',
  'files.search.byName',
  'files.search.byContent'
] as const

/** 既知の command の名前。ここに無い名前は command ではない。 */
export type CommandId = (typeof COMMAND_IDS)[number]

/**
 * 素の値が既知の command 名か。
 *
 * 今は使い道が無い（v1 は defaults.ts しか rule を作らない）。それでも先に
 * 置いてあるのは、**外から来た文字列を通す唯一の関門をここに固定しておく**ため
 * ── 永続化が入るとき、読み込み側がこれを呼ぶ以外の選択肢を持たない形にしておく。
 */
export function isCommandId(value: unknown): value is CommandId {
  return typeof value === 'string' && (COMMAND_IDS as readonly string[]).includes(value)
}
