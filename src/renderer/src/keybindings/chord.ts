/**
 * 打鍵1つの表し方（Session 4-7A）。
 *
 * React にも DOM にも依存しない ── `chordFromEvent` だけが `KeyboardEvent` の
 * **形**を受け取るが、DOM そのものは触らない（構造的部分型で受けるので、
 * テストからは素のオブジェクトを渡せる。`terminal/terminalDisplay.ts` の
 * `TerminalKeyStroke` と同じ切り方）。
 *
 * ## `event.code` を基準にする（`event.key` ではなく）
 *
 * ここが日本語配列との噛み合わせの要点になる。
 *
 * | 見るもの      | 何が返るか                         | 配列を変えると             |
 * | ------------- | ---------------------------------- | -------------------------- |
 * | `event.key`   | **入力される文字**（`'s'` / `'+'`）| 変わる                     |
 * | `event.code`  | **物理キーの位置**（`'KeyS'`）     | 変わらない                 |
 *
 * `Ctrl+Shift+E` を `key` で判定すると、Shift が付いた時点で `key` が `'E'` に
 * なるだけでなく、配列によっては別の文字になる。**位置で見れば、US 配列でも
 * 日本語配列でも同じ物理キーを指す。**
 *
 * `key` へ落ちるのは `code` から名前を決められなかったときだけ（テンキー・
 * IME 経由・未知のキー）。
 *
 * ### 既存の Terminal の打鍵はここを通らない
 *
 * `Ctrl + `+` / `-` / `0`` は `terminal/terminalDisplay.ts` が `event.key` で
 * 判定し続ける（Session 3-7-3 のまま。`=` と `_` の読み替えを持っている）。
 * **Session 4-7A では1行も触っていない。** あちらを `code` へ移すには
 * 日本語配列の `+`（Shift + `;`）の扱いを設計し直すことになり、
 * 既存の挙動を変えずに済ませられない ── Session 4-7B の判断に送る。
 */

/** 打鍵1つ。主キーは正規化済みの名前で持つ。 */
export interface KeyChord {
  /** `'s'` / `'0'` / `','` / `'f1'` / `'enter'` など（常に小文字）。 */
  readonly key: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly alt: boolean
  readonly meta: boolean
}

/** 判定に要るぶんだけの `KeyboardEvent`（DOM 無しで試せるようにするため）。 */
export interface KeyStrokeLike {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

/**
 * `event.code` から主キーの名前へ。
 *
 * 記号は**その物理キーが US 配列で刻印している文字**を名前にしてある
 * （`Comma` → `','`）。日本語配列でも同じ位置を指すので、`ctrl+,` は
 * どちらの配列でも同じキーで効く。
 */
const CODE_TO_KEY: Readonly<Record<string, string>> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'space',
  Enter: 'enter',
  Tab: 'tab',
  Escape: 'escape',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

/** 修飾キーそのもの。単体では打鍵として扱わない。 */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'Dead'
])

/** `parseKeybinding` が主キーとして受け付ける名前（記号1文字を除く）。 */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(CODE_TO_KEY),
  ...Array.from({ length: 24 }, (_, index) => `f${index + 1}`)
])

/**
 * 打鍵から `KeyChord` を作る。**修飾キー単体なら null。**
 *
 * `null` を返すのは「まだ打鍵になっていない」という意味で、失敗ではない
 * （Ctrl を押し下げた時点でも keydown は届く）。
 */
export function chordFromEvent(event: KeyStrokeLike): KeyChord | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null
  }

  const key = normalizeCode(event.code) ?? normalizeKey(event.key)

  if (key === null) {
    return null
  }

  return {
    key,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  }
}

/** `event.code` を主キーの名前へ。決められなければ null（`event.key` へ落とす）。 */
function normalizeCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase()
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5)
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code.toLowerCase()
  }

  return CODE_TO_KEY[code] ?? null
}

/** `event.key` を主キーの名前へ（`code` で決められなかったときだけ）。 */
function normalizeKey(key: string): string | null {
  if (key.length === 1) {
    return key.toLowerCase()
  }

  const lowered = key.toLowerCase()

  return NAMED_KEYS.has(lowered) ? lowered : null
}

/**
 * `'ctrl+shift+s'` のような文字列を `KeyChord` へ。**読めなければ null。**
 *
 * 修飾子を先頭から剥がしていく形にしてあるのは、`'ctrl++'`（Ctrl と `+` キー）を
 * `'+'` で単純に分割すると空の要素が出るため。剥がした残りが主キーになる。
 *
 * `'cmd'` は `'meta'` の別名として受ける（Mac 対応は未着手だが、
 * 保存形式に両方が現れうる ── DESIGN.md の Mac 対応）。
 */
export function parseKeybinding(text: string): KeyChord | null {
  let rest = text.trim().toLowerCase()

  if (rest.length === 0) {
    return null
  }

  let ctrl = false
  let shift = false
  let alt = false
  let meta = false

  for (;;) {
    if (rest.startsWith('ctrl+') || rest.startsWith('control+')) {
      // 同じ修飾子を2度書いたものは読めない形として落とす。
      if (ctrl) {
        return null
      }

      ctrl = true
      rest = rest.slice(rest.indexOf('+') + 1)
      continue
    }

    if (rest.startsWith('shift+')) {
      if (shift) {
        return null
      }

      shift = true
      rest = rest.slice(6)
      continue
    }

    if (rest.startsWith('alt+')) {
      if (alt) {
        return null
      }

      alt = true
      rest = rest.slice(4)
      continue
    }

    if (rest.startsWith('meta+') || rest.startsWith('cmd+')) {
      if (meta) {
        return null
      }

      meta = true
      rest = rest.slice(rest.indexOf('+') + 1)
      continue
    }

    break
  }

  if (!isKeyToken(rest)) {
    return null
  }

  return { key: rest, ctrl, shift, alt, meta }
}

/** 主キーの名前として通る形か。 */
function isKeyToken(token: string): boolean {
  if (token.length === 1) {
    // 記号・英数字1文字（`'+'` も含む）。`chordFromEvent` は常に小文字を返す。
    return true
  }

  return NAMED_KEYS.has(token)
}

/**
 * `KeyChord` を保存・比較のための文字列へ。
 *
 * 修飾子の順序を固定してあるのが要点 ── これが**表を引くときの鍵**になるため、
 * `'shift+ctrl+s'` と `'ctrl+shift+s'` が別の鍵になっては困る。
 */
export function chordToken(chord: KeyChord): string {
  const parts: string[] = []

  if (chord.ctrl) {
    parts.push('ctrl')
  }

  if (chord.shift) {
    parts.push('shift')
  }

  if (chord.alt) {
    parts.push('alt')
  }

  if (chord.meta) {
    parts.push('meta')
  }

  parts.push(chord.key)

  return parts.join('+')
}

/**
 * 画面に出す形（`'Ctrl+Shift+S'`）。
 *
 * 使うのは Session 4-7B 以降の Settings の一覧。今は
 * `keybindings/shortcutRows.ts` が呼ぶだけで、画面には出ていない。
 */
export function formatKeybinding(chord: KeyChord): string {
  const parts: string[] = []

  if (chord.ctrl) {
    parts.push('Ctrl')
  }

  if (chord.shift) {
    parts.push('Shift')
  }

  if (chord.alt) {
    parts.push('Alt')
  }

  if (chord.meta) {
    parts.push('Meta')
  }

  parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : capitalize(chord.key))

  return parts.join('+')
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
