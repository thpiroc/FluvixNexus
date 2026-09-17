import {
  KEYBINDING_TEXT_MAX_LENGTH,
  KEYBINDINGS_MAX_ENTRIES,
  type StoredKeybindingEntry
} from '@shared/keybindings'

/**
 * `keybindings.json` の形の検証（Shortcuts S3）。
 *
 * Electron に依存しない純粋な関数だけを持つ（store/debugBreakpointsDocument.ts と
 * 同じ分け方）。
 *
 * ## ここは形だけを見る
 *
 * 見るのは「オブジェクトか・`key` と `command` が空でない文字列か・長さ・件数」まで。
 * **command 名が実在するか、打鍵として読めるかは見ない** ── それを知っているのは
 * Renderer だけ（renderer/src/keybindings/userKeybindings.ts）。Main が
 * 二重に解釈すると、版が違うときに「Main は落としたが Renderer は読める」が起きる。
 *
 * ## 1行が壊れても全部を捨てない
 *
 * 形の合わない行はその1行だけを落とし、数を返す。**手で1行書き損じたせいで
 * 割り当てが全部消える**のは、breakpoint や設定の section と同じく一番困る結末になる。
 *
 * ファイル全体が配列でない場合だけは、どう読めばよいか決まらないので
 * 読めないファイルとして扱う（呼ぶ側。store/keybindingsStore.ts）。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= KEYBINDING_TEXT_MAX_LENGTH
}

/** 1行ぶん。形が合わなければ null。戻り値は契約にある key だけに絞る。 */
export function parseStoredKeybindingEntry(raw: unknown): StoredKeybindingEntry | null {
  if (!isRecord(raw)) {
    return null
  }

  const { key, command, when } = raw

  if (!isStoredText(key) || !isStoredText(command)) {
    return null
  }

  if (when === undefined) {
    return { key, command }
  }

  /*
    `when` が書かれていて文字列でないなら、その行は落とす。
    「条件を外して読む」にすると、条件付きのつもりの行がどこでも効く。
  */
  if (typeof when !== 'string' || when.length > KEYBINDING_TEXT_MAX_LENGTH) {
    return null
  }

  return { key, command, when }
}

export interface ParsedKeybindingsFile {
  readonly entries: readonly StoredKeybindingEntry[]
  readonly skippedCount: number
}

/**
 * ファイル全体。配列でなければ null（読めないファイル）。
 *
 * 上限を超えた行は、先頭から数えて残し、残りを読み飛ばした数に含める。
 */
export function parseKeybindingsFile(raw: unknown): ParsedKeybindingsFile | null {
  if (!Array.isArray(raw)) {
    return null
  }

  const entries: StoredKeybindingEntry[] = []
  let skippedCount = 0

  for (const candidate of raw) {
    const entry =
      entries.length < KEYBINDINGS_MAX_ENTRIES ? parseStoredKeybindingEntry(candidate) : null

    if (entry === null) {
      skippedCount += 1
      continue
    }

    entries.push(entry)
  }

  return { entries, skippedCount }
}

/**
 * 保存の要求。**1行でも形が合わなければ null**（保存に進まない）。
 *
 * 読み込みと違って落として進めないのは、要求を作ったのがアプリ自身だから ──
 * 形の合わない行が来るのは Renderer の誤りで、黙って削って書くと
 * 利用者の割り当てが静かに減る。
 */
export function parseSaveKeybindingsRequest(
  request: unknown
): { readonly entries: readonly StoredKeybindingEntry[] } | null {
  if (!isRecord(request) || !Array.isArray(request.entries)) {
    return null
  }

  if (request.entries.length > KEYBINDINGS_MAX_ENTRIES) {
    return null
  }

  const entries: StoredKeybindingEntry[] = []

  for (const candidate of request.entries) {
    const entry = parseStoredKeybindingEntry(candidate)

    if (entry === null) {
      return null
    }

    entries.push(entry)
  }

  return { entries }
}
