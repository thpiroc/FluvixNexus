import { listAllowedModelIds, SUPPORTED_PROVIDER_IDS } from '@shared/aiProvider'
import { AGENT_PERMISSION_MODES, FAIL_CLOSED_AGENT_PERMISSION_MODE } from '@shared/security'
import {
  emptySettingsSections,
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

/**
 * key 1つの型。
 *
 * Session 5-4 で `boolean` が増えた（`lsp` section）。ここに増えるのは
 * **JSON がそのまま持てる素の型**だけに留める ── 配列や object を許すと、
 * 「読める形か」を確かめる範囲が中身の深さに応じて広がり、
 * Main が値の意味を解釈しないという分担が保てなくなる。
 */
type FieldKind = 'string' | 'number' | 'boolean'

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
  /*
    Session 5-4 で足した section。**この section だけは Main も値の意味を読む**
    ── プロセスを立てる / 終わらせるのは Main の側で、有効かどうかは
    Renderer の中では完結しないため（shared/lsp/serverSettings.ts）。

    それでも**ここは形しか見ない**。「真偽値であること」を確かめるのがここで、
    「無ければ有効」「読めなければ有効」と決めるのは shared の
    `normalizeLanguageServerPreferences` になる ── 分担そのものは変えていない。

    実行ファイルのパスや引数の欄は無い（shared/settings/sections.ts）。
    ここへ `string` の欄を1つ足した時点で、設定ファイルは
    「利用者と Renderer が指定した実行ファイルが起動する場所」になる。
  */
  lsp: {
    enabled: 'boolean',
    typescriptEnabled: 'boolean',
    pythonEnabled: 'boolean',
    csharpEnabled: 'boolean'
  },
  files: { viewMode: 'string', columnWidth: 'number' },
  terminal: { fontSize: 'number', scrollback: 'number' },
  /*
    MCP の全体の元栓。`lsp` と同じく Main も値の意味を読む
    （MCP サーバーを起動するのは Main の側。main/mcp/mcpService.ts）。

    **ここに秘密の値の欄は無い。** 欄を1つ足した時点で、`settings.json` は
    平文の秘密情報が載るファイルになる ── 置き場所は OS の資格情報で
    暗号化した別ファイルにあたる（main/mcp/mcpSecretStore.ts）。
  */
  mcp: { enabled: 'boolean' },
  /*
    FN Agent の Provider / Model（STEP10-5）。`security` と同じく、保存の要求は形に加えて
    値まで Main が見る（下の SECTION_FIELD_CHOICES）── 正式な Provider の閉じた集合と
    Model の allowlist の外は保存させない。

    **API Key と Endpoint の欄は無い。** Key は OS の資格情報で暗号化した別ファイル
    （main/aiProvider/aiProviderCredentialStore.ts）、Endpoint は Provider Adapter の内部に固定する。
  */
  aiProvider: { providerId: 'string', modelId: 'string' },
  /*
    FN Agent の Permission（Security Core v1）。形は文字列だが、この section だけは
    **形に加えて値の意味まで Main が見る**（下の2つの表）── Security を緩める側へ
    倒れる読み替えを、Renderer 側の分担に任せない。
  */
  security: { permissionMode: 'string', agentEnabled: 'boolean' }
}

/**
 * 保存要求で受け付ける値を、形より狭く限る key（Security Core v1）。
 *
 * 他の key は「後で解釈できる形か」しか見ない（上の分担）が、ここに挙げた key は
 * **知らない値を保存させない**。`security.permissionMode` に `auto` や `allow` を
 * 送っても、要求ごと拒まれる（INVALID_REQUEST。ipc/handlers/settings.ts）。
 *
 * 読み込みには掛けない ── ディスクにある知らない値は、落とさず次の表の値に置き換える
 * （読めた文字列はそのまま持ち、使う側が `read` へ倒す。shared/security/permissionMode.ts）。
 */
const SECTION_FIELD_CHOICES: {
  readonly [Id in SettingsSectionId]?: {
    readonly [K in keyof SettingsSections[Id] & string]?: readonly string[]
  }
} = {
  security: { permissionMode: AGENT_PERMISSION_MODES },
  /*
    知らない Provider（`scripted` を含む）・allowlist に無い Model は要求ごと拒む（STEP10-5）。
    Model の allowlist が空の間は、どの Model も保存できない（正式な Model は STEP10-6 で決める）。
  */
  aiProvider: { providerId: SUPPORTED_PROVIDER_IDS, modelId: listAllowedModelIds() }
}

/**
 * 読めなかったときに、落とさずに置き換える値（Security Core v1）。
 *
 * 他の key は読めなければ落とす（＝既定）。既定が「緩い側」にある key でそれをすると、
 * **ファイルが壊れただけで Security が緩む**（`read` を選んでいた人が既定の `ask` へ戻る）。
 * ここに挙げた key は、次の場合に最も厳しい値へ置き換える。
 *
 * ```
 * key の値が読めない（文字列でない・長すぎる）
 * section が object でない
 * 文書そのものが読めない（壊れた JSON・版が読めない・移行できない・sections が object でない）
 * ```
 *
 * 置き換えた値はメモリ上の文書に入るので、次に何かを保存すればファイルにも
 * そのまま書かれる（壊れた跡が、厳しい値として残る）。
 */
export const FAIL_CLOSED_SECTION_VALUES: {
  readonly [Id in SettingsSectionId]?: SettingsSections[Id]
} = {
  security: {
    permissionMode: FAIL_CLOSED_AGENT_PERMISSION_MODE,
    // Agent の ON / OFF（STEP9）。壊れていたら OFF（使わない側）へ倒す。
    agentEnabled: false
  }
}

/**
 * 文書が読めなかったときの section（すべて空、ただし `FAIL_CLOSED_SECTION_VALUES` は入る）。
 *
 * **「ファイルが無い」には使わない。** 無いのは初回起動の正常な状態で、既定で始める。
 */
export function failClosedSettingsSections(): SettingsSections {
  return { ...emptySettingsSections(), ...FAIL_CLOSED_SECTION_VALUES }
}

/**
 * このアプリがかつて持っていて、撤去した key。
 *
 * 知らない key は「新しい版が書いたもの」として書き戻すが、ここに挙げた key は
 * **古い版のこのアプリが書いたもの**で、もう誰も読まない。読み込んだ時点で落とし、
 * 書き戻さない（見つけたら store が1度だけ書き直す。settingsStore.ts）。
 *
 * 名前は再利用しない ── 既にある key の意味は版をまたいで変えない約束
 * （shared/settings/settingsDocument.ts）の裏返しにあたる。
 */
export const RETIRED_SECTION_FIELDS: Readonly<
  Partial<Record<SettingsSectionId, readonly string[]>>
> = {
  // 旧 Notion MCP（アプリに組み込みだった接続）の栓。MCP Server Manager へ一本化した。
  mcp: ['notionEnabled']
}

/** ファイルから読んだ section 1つの結果。 */
export interface ParsedStoredSection {
  /** 読めた key だけを持つ値（読めなかった key は無い ＝ 既定）。 */
  readonly value: Record<string, unknown>
  /** この版が知らない key（そのまま書き戻す）。 */
  readonly unknownFields: Record<string, unknown>
  /** 落とした key の名前（ログ用）。section ごと読めなかった場合は空になる。 */
  readonly droppedFields: readonly string[]
  /** 撤去した key で、ファイルに残っていたもの（書き戻さない）。 */
  readonly retiredFields: readonly string[]
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
  const failClosed = (FAIL_CLOSED_SECTION_VALUES[id] ?? {}) as Readonly<Record<string, unknown>>

  if (!isPlainObject(raw)) {
    return {
      // 無い section は既定。在るのに読めない section は、置き換える値があればそれで始める。
      value: raw === undefined ? {} : { ...failClosed },
      unknownFields: {},
      droppedFields: [],
      retiredFields: [],
      readable: false
    }
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
      // 落とした上で、置き換える値がある key はそれを入れる（既定へ緩めない）。
      dropped.push(name)

      if (failClosed[name] !== undefined) {
        value[name] = failClosed[name]
      }
    }
  }

  const retired = RETIRED_SECTION_FIELDS[id] ?? []

  return {
    value,
    unknownFields: preservableEntries(raw, [...Object.keys(fields), ...retired]),
    droppedFields: dropped,
    retiredFields: retired.filter((name) => raw[name] !== undefined),
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
  const choices = (SECTION_FIELD_CHOICES[section] ?? {}) as Readonly<
    Record<string, readonly string[] | undefined>
  >
  const accepted: Record<string, unknown> = {}

  for (const [name, kind] of Object.entries(fields)) {
    const found = value[name]

    if (found === undefined) {
      continue
    }

    if (!isReadableValue(found, kind)) {
      return null
    }

    // 値を限ってある key は、知らない値を保存しない（Security を緩める値を書かせない）。
    const allowed = choices[name]

    if (allowed !== undefined && !allowed.includes(found as string)) {
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
  switch (kind) {
    case 'string':
      return typeof value === 'string' && value.length <= SETTINGS_TEXT_MAX_LENGTH

    case 'number':
      return typeof value === 'number' && Number.isFinite(value)

    case 'boolean':
      /*
        `'true'` も `1` も通さない。**寛容に読み替えると、書いた側の誤りが
        設定ファイルの中で正しい値に化ける** ── 読めない値は落として
        既定（有効）へ戻す方が、後から原因を辿れる。
      */
      return typeof value === 'boolean'
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
