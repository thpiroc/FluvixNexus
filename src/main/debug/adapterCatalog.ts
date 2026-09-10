/**
 * Debug Adapter の Main-owned catalog foundation。
 *
 * Session 6-1 では実 adapter との統合は行わない。ここには閉じた集合だけを置き、
 * executable / args / cwd を Renderer から指定できる形を作らない。
 */

export const DEBUG_ADAPTER_LANGUAGE_IDS = ['node', 'python', 'csharp'] as const

export type DebugAdapterLanguageId = (typeof DEBUG_ADAPTER_LANGUAGE_IDS)[number]
export type DebugAdapterIntegrationStatus = 'not-integrated'

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
