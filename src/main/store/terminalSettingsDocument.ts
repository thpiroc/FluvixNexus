import {
  TERMINAL_SETTINGS_DOCUMENT_MAX_BYTES,
  type TerminalSettingsDocument
} from '@shared/settings'

/**
 * Terminal 設定文書の検証（Electron にも fs にも依存しない。Session 3-7-5）。
 *
 * 保存済みファイルの読み込みと、Renderer から届いた保存要求の**両方**がここを通る。
 * どちらも境界の外から来た値であり、扱いを分ける理由が無いため
 * （store/editorSettingsDocument.ts / store/filesSettingsDocument.ts と同じ立ち位置）。
 *
 * ## Main はどこまで見るか
 *
 * | 層       | 見るもの                                                         |
 * | -------- | ---------------------------------------------------------------- |
 * | Main     | 形として読めるか（schemaVersion / display の項目の型）・大きさ    |
 * | Renderer | 値として扱ってよい範囲か（8〜32px / 500〜50000 行）               |
 *
 * Editor 設定（§12.4）・Files 設定（§10.14）と同じ分担にしてある。**端末の見え方の
 * 意味を知っているのは Renderer だけ**で、Main が中身まで解釈すると「どちらの判断が
 * 正しいか」が生まれる。ここで見るのは「後で解釈できる形か」までに留める。
 *
 * 文字の大きさは IPC を1度も渡らない値でもある（ARCHITECTURE.md §13.4）── Main が
 * ConPTY へ渡すのは桁数と行数だけで、px も行数の上限も Main の関心事ではない。
 * それでも**保存先を持っているのは Main** なので、ディスクへ残す形かどうかだけを見る。
 *
 * そのため桁外れの `fontSize` も、負の `scrollback` も失敗ではなく、読む側
 * （renderer/src/terminal/terminalDisplay.ts）が範囲へ丸める。
 */

/** 素の値が文書として読めるか。読めなければ null（＝既定で始める）。 */
export function parseTerminalSettingsDocument(raw: unknown): TerminalSettingsDocument | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }

  const { schemaVersion, display } = raw as { schemaVersion: unknown; display: unknown }

  if (!isPositiveInteger(schemaVersion)) {
    return null
  }

  if (typeof display !== 'object' || display === null || Array.isArray(display)) {
    return null
  }

  const { fontSize, scrollback } = display as { fontSize: unknown; scrollback: unknown }

  if (!Number.isFinite(fontSize) || !Number.isFinite(scrollback)) {
    return null
  }

  /*
    桁違いに大きな内容をそのままディスクへ残さない。
    設定は数十バイトにしかならず、これを超えるのは想定外の書き込みしかない。
  */
  if (!isWithinSizeLimit(raw)) {
    return null
  }

  return {
    schemaVersion,
    // 知っている項目だけを写す。余計な項目を保存し続けない。
    display: { fontSize: fontSize as number, scrollback: scrollback as number }
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isWithinSizeLimit(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= TERMINAL_SETTINGS_DOCUMENT_MAX_BYTES
  } catch {
    // 循環参照など。文書として書けない時点で受け付けない。
    return false
  }
}
