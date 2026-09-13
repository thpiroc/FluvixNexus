/**
 * Debug Adapter の Main-owned catalog foundation。
 *
 * Session 6-1 では実 adapter との統合は行わない。ここには閉じた集合だけを置き、
 * executable / args / cwd を Renderer から指定できる形を作らない。
 */

export const DEBUG_ADAPTER_LANGUAGE_IDS = ['node', 'python', 'csharp'] as const

export type DebugAdapterLanguageId = (typeof DEBUG_ADAPTER_LANGUAGE_IDS)[number]
/**
 * その行の adapter を、この版が起動できるか。
 *
 * `integrated` は Session 6-9 で型にだけ足した（どの行もまだ使っていない）。
 * Debug の状態（shared/debug/status.ts の `unavailable`）がこの事実から導かれるため、
 * 実 adapter を繋ぐ Session（6-10 / 6-11）が行を書き換えれば、状態の側は1行も変わらずに
 * `unavailable` から `idle` へ移る。
 */
export type DebugAdapterIntegrationStatus = 'integrated' | 'not-integrated'

export interface DebugAdapterCatalogEntry {
  readonly language: DebugAdapterLanguageId
  readonly name: string
  readonly integrationStatus: DebugAdapterIntegrationStatus
}

export interface DebugAdapterCommand {
  readonly name: string
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

const DEBUG_ADAPTER_CATALOG: Record<DebugAdapterLanguageId, DebugAdapterCatalogEntry> = {
  node: {
    language: 'node',
    name: 'Node.js Debug Adapter',
    integrationStatus: 'not-integrated'
  },
  python: {
    language: 'python',
    name: 'debugpy',
    integrationStatus: 'not-integrated'
  },
  csharp: {
    language: 'csharp',
    name: 'netcoredbg',
    integrationStatus: 'not-integrated'
  }
}

export function isDebugAdapterLanguageId(value: string): value is DebugAdapterLanguageId {
  return DEBUG_ADAPTER_LANGUAGE_IDS.includes(value as DebugAdapterLanguageId)
}

export function getDebugAdapterCatalogEntry(
  language: DebugAdapterLanguageId
): DebugAdapterCatalogEntry {
  return DEBUG_ADAPTER_CATALOG[language]
}

export function listDebugAdapterCatalogEntries(): readonly DebugAdapterCatalogEntry[] {
  return DEBUG_ADAPTER_LANGUAGE_IDS.map((language) => DEBUG_ADAPTER_CATALOG[language])
}

/**
 * 起動できる adapter が1つでもあるか（Session 6-9。Debug の状態の `unavailable` の根拠）。
 *
 * **catalog の行だけを見る。** PATH を探して実行ファイルがあるかまでは見ない ──
 * それは実 adapter を繋ぐ Session の仕事で、ここで探すと状態を読むたびに
 * ファイルシステムへ触ることになる。結果は真偽値1つで、名前もパスも外へ出ない。
 */
export function hasIntegratedDebugAdapter(
  entries: readonly DebugAdapterCatalogEntry[] = listDebugAdapterCatalogEntries()
): boolean {
  return entries.some((entry) => entry.integrationStatus === 'integrated')
}
