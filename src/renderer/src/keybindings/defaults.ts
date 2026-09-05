import type { KeybindingRule } from './resolve'

/**
 * 既定の割り当て（Session 4-7A）。
 *
 * **v1 が rule を作る唯一の場所。** User / Workspace の割り当ては
 * まだ存在しない（`keybindings.json` の永続化は Session 4-7 の範囲外）。
 *
 * ## 選び方
 *
 * 1. **既にある打鍵を1つも変えない。** `ctrl+s` は Session 3-5 から
 *    `editor/useEditorSession.ts` の window listener が持っていたもので、
 *    ここへ移しただけ ── 条件を付けていないのはそのため（下記）
 * 2. **Monaco が使っている打鍵を取らない。** `ctrl+f` / `ctrl+h` / `ctrl+g` /
 *    `ctrl+/` / `ctrl+shift+k` などは Monaco の既定。取ると Editor の中で
 *    それらが死ぬ
 * 3. **端末を触っている最中にアプリ側の操作を走らせない。** `ctrl+j` は端末では
 *    改行（0x0A）、`ctrl+o` は 0x0F にあたる ── どれも
 *    `'!terminalFocused'` を付けてある。**この条件は実際に効いている** ──
 *    `ctrl+,` のように xterm が消費しない打鍵は `window` まで上がってくるため、
 *    条件が無ければ端末で打っている最中に Settings が開く
 *    （Session 4-7A で実機に確認）
 * 4. **`ctrl+p` / `ctrl+shift+p` は空けてある。** Command Palette の席
 *    （Session 4-7 の範囲外）
 * 5. **日本語配列で同じ物理キーになるものだけ。** `` ctrl+` `` は入れていない ──
 *    あの位置は日本語配列では半角/全角キーで、IME の切り替えとぶつかる
 *    （Terminal の開閉は `ctrl+j` に置いた）
 *
 * ## `editor.save` に条件を付けていない
 *
 * Session 4-7A より前の `ctrl+s` は `window` に直接付いていて、条件を1つも
 * 持っていなかった（`editor/useEditorSession.ts`）。ここでも条件を付けないのは、
 * **移設で振る舞いを変えないため**にほかならない。
 *
 * `'!terminalFocused'` を付けていないが、これは「端末の中でも保存される」
 * という意味ではない ── **端末に focus があるとき Ctrl+S は `window` まで
 * 上がってこない**（xterm が `stopPropagation` する。Session 4-7A で実機に
 * window listener を仕込んで確かめた）。移設前も同じ形の listener だったので、
 * 端末の中で Ctrl+S が効かないのは**以前からそうだった**ことになる。
 *
 * つまりここに条件を足しても引いても、端末の中の振る舞いは変わらない。
 * 変わるのは Files のツリーや Git の面に focus があるときで、そこは
 * 移設前に効いていた ── だから条件を足さない。
 *
 * 移設で変わってよいのは「確認ダイアログの裏では走らない」の1点だけで、
 * それは rule ではなく `dispatch()` の全体規則として入れてある。
 *
 * ## 割り当ての無い command
 *
 * `workspace.closeFolder` / `view.togglePanel.editor` / `view.resetLayout` /
 * `settings.close` はここに出てこない。**handler はあるが打鍵が無い**状態で、
 * これは将来の Settings の一覧で「未割り当て」として出る行にあたる
 * （`settings.close` は Esc が既に持っているので、二重に割り当てない ──
 * 既存の Esc 17箇所には触らないという Session 4-7A の前提）。
 */
export const DEFAULT_KEYBINDINGS: readonly KeybindingRule[] = [
  {
    commandId: 'editor.save',
    key: 'ctrl+s',
    source: 'default'
  },
  {
    /*
      `editor.save` と違い、これは Session 4-7A で**新しく付けた**割り当てになる
      （Session 4-2 の時点では「基盤と同時にする」として置いていなかった）。
      守るべき既存の挙動が無いので、端末を避ける規則の側に素直に従う ──
      端末では Ctrl+Shift+S も Ctrl+S と同じ 0x13 として届く。
    */
    commandId: 'editor.saveAs',
    key: 'ctrl+shift+s',
    when: ['editorHasActiveTab', '!terminalFocused'],
    source: 'default'
  },
  {
    commandId: 'workspace.openFolder',
    key: 'ctrl+o',
    when: ['!terminalFocused'],
    source: 'default'
  },
  {
    commandId: 'settings.open',
    key: 'ctrl+,',
    when: ['!terminalFocused'],
    source: 'default'
  },
  {
    commandId: 'view.togglePanel.files',
    key: 'ctrl+shift+e',
    when: ['!terminalFocused', '!settingsOpen'],
    source: 'default'
  },
  {
    commandId: 'view.togglePanel.git',
    key: 'ctrl+shift+g',
    when: ['!terminalFocused', '!settingsOpen'],
    source: 'default'
  },
  {
    commandId: 'view.togglePanel.terminal',
    key: 'ctrl+j',
    when: ['!terminalFocused', '!settingsOpen'],
    source: 'default'
  }
]
