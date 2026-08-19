import { FILES_SETTINGS_DOCUMENT_MAX_BYTES, type FilesSettingsDocument } from '@shared/settings'

/**
 * Files 設定文書の検証（Electron にも fs にも依存しない。Session 3-6-8）。
 *
 * 保存済みファイルの読み込みと、Renderer から届いた保存要求の**両方**がここを通る。
 * どちらも境界の外から来た値であり、扱いを分ける理由が無いため
 * （store/editorSettingsDocument.ts と同じ立ち位置）。
 *
 * ## Main はどこまで見るか
 *
 * | 層       | 見るもの                                                       |
 * | -------- | -------------------------------------------------------------- |
 * | Main     | 形として読めるか（schemaVersion / view の項目の型）・大きさ     |
 * | Renderer | mode として意味があるか・幅の上下限                            |
 *
 * Editor 設定（§12.4）と同じ分担にしてある。**見え方の意味を知っているのは
 * Renderer だけ**で、Main が中身まで解釈すると「どちらの判断が正しいか」が生まれる。
 * ここで見るのは「後で解釈できる形か」までに留める。
 *
 * そのため `mode` は**文字列であること**しか見ない。知らない mode も、
 * 桁外れの `columnWidth` も失敗ではなく、読む側（renderer/src/files/filesSettings.ts）が
 * 既定と上下限へ落とす。
 */

/** 素の値が文書として読めるか。読めなければ null（＝既定で始める）。 */
export function parseFilesSettingsDocument(raw: unknown): FilesSettingsDocument | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }

  const { schemaVersion, view } = raw as { schemaVersion: unknown; view: unknown }

  if (!isPositiveInteger(schemaVersion)) {
    return null
  }

  if (typeof view !== 'object' || view === null || Array.isArray(view)) {
    return null
  }

  const { mode, columnWidth } = view as { mode: unknown; columnWidth: unknown }

  if (typeof mode !== 'string' || !Number.isFinite(columnWidth)) {
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
    view: { mode, columnWidth: columnWidth as number }
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isWithinSizeLimit(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= FILES_SETTINGS_DOCUMENT_MAX_BYTES
  } catch {
    // 循環参照など。文書として書けない時点で受け付けない。
    return false
  }
}
