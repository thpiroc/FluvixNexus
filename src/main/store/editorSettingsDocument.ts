import { EDITOR_SETTINGS_DOCUMENT_MAX_BYTES, type EditorSettingsDocument } from '@shared/settings'

/**
 * Editor 設定文書の検証（Electron にも fs にも依存しない）。
 *
 * 保存済みファイルの読み込みと、Renderer から届いた保存要求の**両方**がここを通る。
 * どちらも境界の外から来た値であり、扱いを分ける理由が無いため
 * （store/workspaceLayoutDocument.ts と同じ立ち位置）。
 *
 * ## Main はどこまで見るか
 *
 * | 層       | 見るもの                                                        |
 * | -------- | --------------------------------------------------------------- |
 * | Main     | 形として読めるか（schemaVersion / autoSave の項目の型）・大きさ |
 * | Renderer | mode として意味があるか・待ち時間の上下限                       |
 *
 * レイアウト（§7.8）と同じ分担にしてある。設定の**意味**を知っているのは
 * Renderer（editor/autoSave.ts）だけで、Main が中身まで解釈すると
 * 「どちらの判断が正しいか」が生まれる。ここで見るのは
 * 「後で解釈できる形か」までに留める。
 *
 * そのため `mode` は**文字列であること**しか見ない。知らない mode（アプリを
 * ダウングレードした場合など）は失敗ではなく、読む側が既定へ落とす。
 */

/** 素の値が文書として読めるか。読めなければ null（＝既定で始める）。 */
export function parseEditorSettingsDocument(raw: unknown): EditorSettingsDocument | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }

  const { schemaVersion, autoSave } = raw as {
    schemaVersion: unknown
    autoSave: unknown
  }

  if (!isPositiveInteger(schemaVersion)) {
    return null
  }

  if (typeof autoSave !== 'object' || autoSave === null || Array.isArray(autoSave)) {
    return null
  }

  const { mode, delayMs } = autoSave as { mode: unknown; delayMs: unknown }

  if (typeof mode !== 'string' || !Number.isFinite(delayMs)) {
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
    autoSave: { mode, delayMs: delayMs as number }
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isWithinSizeLimit(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= EDITOR_SETTINGS_DOCUMENT_MAX_BYTES
  } catch {
    // 循環参照など。文書として書けない時点で受け付けない。
    return false
  }
}
