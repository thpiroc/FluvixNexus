import type { DebugProfilesDocument } from '@shared/debug'
import { parseDebugProfilesDocument } from './debugProfilesDocument'
import { createJsonStore, type JsonStore } from './jsonStore'

/**
 * Debug Profile の保存先（Session 6-10）。
 *
 * 保存されるのは `%APPDATA%/Fluvix Nexus/debug-profiles.json`
 * （app.getPath('userData') 配下。jsonStore.ts が決める）。
 * **Workspace の中には何も書かない**（docs/ARCHITECTURE.md §20.5）。
 *
 * breakpoint（store/debugBreakpoints.ts）とは別のファイルにする ── 一方は
 * 「何を起動するか」、もう一方は「どこで止めるか」で、壊れたときに巻き添えにする理由が無い。
 */

const STORE_FILE_NAME = 'debug-profiles.json'

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点でストアを作る。 */
let store: JsonStore<DebugProfilesDocument> | null = null

function getStore(): JsonStore<DebugProfilesDocument> {
  store ??= createJsonStore(STORE_FILE_NAME, parseDebugProfilesDocument)
  return store
}

/** 保存済みの文書。未保存・破損・想定外の内容なら null。 */
export function readDebugProfilesDocument(): DebugProfilesDocument | null {
  return getStore().read()
}

/** 文書の保存を予約する。連続した依頼は最後の1回にまとめられる。 */
export function saveDebugProfilesDocument(document: DebugProfilesDocument): void {
  getStore().save(document)
}

/** 予約済みの書き込みを即座に反映する（app の will-quit）。 */
export function flushDebugProfilesDocument(): void {
  store?.flush()
}
