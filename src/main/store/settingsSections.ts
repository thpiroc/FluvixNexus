import {
  isSettingsSectionId,
  SETTINGS_PRESERVED_MAX_BYTES,
  SETTINGS_TEXT_MAX_LENGTH,
  type SettingsSectionId,
  type SettingsSections,
  type SettingsSectionUpdate
} from '@shared/settings'

/**
 * section 1つ分の検証（Electron にも fs にも依存しない。Session 4-3A）。
 *
 * 保存済みファイルの読み込みと、Renderer から届いた保存要求の**両方**がここを通る。
 * どちらも境界の外から来た値であり、扱いを分ける理由が無いため
 * （store/workspaceLayoutDocument.ts と同じ立ち位置）。
 *
 * ## Main はどこまで見るか
 *
 * | 層       | 見るもの                                       |
 * | -------- | ---------------------------------------------- |
 * | Main     | key ごとの型・長さ（＝後で解釈できる形か）     |
 * | Renderer | 値として意味があるか（mode の名前・上下限）    |
 *
 * Session 3-5 からの分担をそのまま引き継いでいる。そのため `autoSaveMode` は
 * **文字列であること**しか見ない ── 知らない mode（アプリをダウングレードした場合など）は
 * 失敗ではなく、読む側が既定へ落とす。
 *
 * ## 読むときと書くときで、寛容さを変える
 *
 * | 経路                       | 読めない key   | 知らない key       |
 * | -------------------------- | -------------- | ------------------ |
 * | ファイルから読む           | その key を落とす | 書き戻すために持つ |
 * | Renderer からの保存要求    | 要求ごと拒む   | 保存しない         |
 *
 * ディスクにある未知の値は「新しい版が書いたもの」でありうるが、Renderer から届く
 * 未知の値は契約に無い値でしかない。読めない key を保存要求で黙って落とさないのも
 * 同じ線で、**それは Renderer 側の不具合であって、静かに消えると気づけない。**
 */

type FieldKind = 'string' | 'number'

/** section の中で、この版が知っている key とその型。 */
type SectionFieldSpec<Id extends SettingsSectionId> = {
  readonly [K in keyof SettingsSections[Id] & string]-?: FieldKind
}

/**
 * 既知の key の表。
 *
 * section を足すときに触るのはここと `SETTINGS_SECTION_IDS`（shared/settings/sections.ts）
 * だけになる。key を書き忘れると型が通らない（`-?` で必須にしてある）。
 */
const SECTION_FIELDS: { readonly [Id in SettingsSectionId]: SectionFieldSpec<Id> } = {
  general: { language: 'string' },
  /*
    Session 4-4 で足した section。`theme` を**文字列であること**しか見ないのは
    `autoSaveMode` ・`viewMode` と同じ分担にほかならない ── `dark` / `light` の
    どちらかであるかを決めるのは Renderer（shared/theme/theme.ts の
    `normalizeThemeId`）で、ここで名前まで見ると同じ判断が2箇所に生まれる。

    Main が Theme の名前を知っている場所は1つだけある（windows/mainWindow.ts ──
    最初の1枚を塗る色を決めるため）が、それは**検証ではなく描画の都合**で、
    読めない値でも既定の色を塗るだけで済む。
  */
  appearance: { theme: 'string' },
  editor: { autoSaveMode: 'string', autoSaveDelayMs: 'number' },
  files: { viewMode: 'string', columnWidth: 'number' },
  terminal: { fontSize: 'number', scrollback: 'number' }
}

/** ファイルから読んだ section 1つの結果。 */
export interface ParsedStoredSection {
  /** 読めた key だけを持つ値（読めなかった key は無い ＝ 既定）。 */
  readonly value: Record<string, unknown>
  /** この版が知らない key（そのまま書き戻す）。 */
  readonly unknownFields: Record<string, unknown>
  /** 落とした key の名前（ログ用）。section ごと読めなかった場合は空になる。 */
  readonly droppedFields: readonly string[]
  /** section として読めたか（object だったか）。 */
  readonly readable: boolean
}

/**
 * ファイルから読んだ section 1つを検証する。
 *
 * **key 単位で落とす。** 1つの key が読めないだけで section ごと既定へ戻すと、
 * 「文字の大きさを手で書き換えて壊した」だけでさかのぼれる行数まで失われる。
 */
export function parseStoredSection(id: SettingsSectionId, raw: unknown): ParsedStoredSection {
  if (!isPlainObject(raw)) {
    return { value: {}, unknownFields: {}, droppedFields: [], readable: false }
  }

  const fields = SECTION_FIELDS[id] as Readonly<Record<string, FieldKind>>
  const value: Record<string, unknown> = {}
  const dropped: string[] = []

  for (const [name, kind] of Object.entries(fields)) {
    const found = raw[name]

    // 無いのは正常（＝既定）。落とした key として数えない。
    if (found === undefined) {
      continue
    }

    if (isReadableValue(found, kind)) {
      value[name] = found
    } else {
      dropped.push(name)
    }
  }

  return {
    value,
    unknownFields: preservableEntries(raw, Object.keys(fields)),
    droppedFields: dropped,
    readable: true
  }
}

/**
 * Renderer から届いた保存要求を検証する。
 *
 * 通らなければ null（呼ぶ側が INVALID_REQUEST にする）。**型は入口にすぎない** ──
 * IPC を渡ってくる値は型を名乗っているだけなので、ここで実際に確かめる。
 *
 * 知らない key は保存しない（＝要求は通すが、その key は落ちる）。既知の key が
 * 読めない形で届いた場合は要求ごと拒む ── どちらも「Renderer が好きな内容を
 * ディスクへ残せる場所を作らない」ためにある。
 */
export function parseSettingsSectionUpdate(raw: unknown): SettingsSectionUpdate | null {
  if (!isPlainObject(raw)) {
    return null
  }

  const { section, value } = raw

  if (!isSettingsSectionId(section) || !isPlainObject(value)) {
    return null
  }

  const fields = SECTION_FIELDS[section] as Readonly<Record<string, FieldKind>>
  const accepted: Record<string, unknown> = {}

  for (const [name, kind] of Object.entries(fields)) {
    const found = value[name]

    if (found === undefined) {
      continue
    }

    if (!isReadableValue(found, kind)) {
      return null
    }

    accepted[name] = found
  }

  // section 名で型が決まるユニオンなので、ここだけは組み立て直しの assertion が要る。
  return { section, value: accepted } as SettingsSectionUpdate
}

/**
 * この版が知らない項目を、書き戻せる形で取り出す。
 *
 * 大きすぎるもの・JSON にできないもの（循環参照など）は持ち回さない ──
 * 「知らないものは書き戻す」は将来の版のためのものであって、
 * 何でも置ける場所ではない。
 */
export function preservableEntries(
  source: Readonly<Record<string, unknown>>,
  knownKeys: readonly string[]
): Record<string, unknown> {
  const known = new Set(knownKeys)
  const preserved: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(source)) {
    if (known.has(name) || value === undefined) {
      continue
    }

    if (isPreservable(value)) {
      preserved[name] = value
    }
  }

  return preserved
}

function isPreservable(value: unknown): boolean {
  try {
    const text = JSON.stringify(value)
    return text !== undefined && text.length <= SETTINGS_PRESERVED_MAX_BYTES
  } catch {
    return false
  }
}

function isReadableValue(value: unknown, kind: FieldKind): boolean {
  return kind === 'string'
    ? typeof value === 'string' && value.length <= SETTINGS_TEXT_MAX_LENGTH
    : typeof value === 'number' && Number.isFinite(value)
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
