import { renameSync } from 'fs'
import { join } from 'path'
import type { LoadKeybindingsResponse } from '@shared/ipc'
import type { StoredKeybindingEntry } from '@shared/keybindings'
import { createJsonFileWriter, readJsonFile } from './jsonFile'
import { parseKeybindingsFile } from './keybindingsDocument'

/**
 * `keybindings.json` の読み書き（Shortcuts S3）。
 *
 * 保存先のフォルダを引数で受け取るのは settingsStore.ts と同じ理由で、
 * 実際のディスクを使って試せるようにするため。userData を渡すのは
 * store/keybindings.ts の役目。
 *
 * ## 読むのは1度だけ
 *
 * 読み込んだ内容はメモリに残し、保存のたびに差し替える。保存は間引かれる
 * （400ms）ので、その間に読み直すとディスクの古い内容が返ってしまう ──
 * メモリを正にしておけば、その食い違いが起きない。
 *
 * ## 壊れたファイルは、上書きする前に退避する
 *
 * JSON として読めない（または配列でない）ファイルは、読み込みでは
 * 「割り当てが無い」として扱い、アプリは既定の割り当てで動く。
 *
 * そのまま保存すると、**利用者が手で書いていた内容が跡形もなく消える**。
 * そこで最初の保存の前に `keybindings.broken-<日時>.json` へ名前を変えて残す。
 * 保存を拒む形にしなかったのは、壊れた1ファイルのせいで画面から割り当てを
 * 一切変えられなくなるため（直し方を知らない人ほど困る）。
 *
 * 退避は保存を予約した時点で同期的に行う。間引きの後に回すと、その間に終了した
 * とき（flush）と通常の書き込みの2箇所で同じ判断が要る。
 */

export const KEYBINDINGS_FILE_NAME = 'keybindings.json'

export interface KeybindingsStore {
  /** 保存済みの割り当て。初回の呼び出しで読み込む。 */
  read(): LoadKeybindingsResponse
  /** 割り当てを丸ごと保存する。連続呼び出しは間引かれる。 */
  save(entries: readonly StoredKeybindingEntry[]): void
  /** 予約済みの書き込みを即座に反映する。 */
  flush(): void
}

export type KeybindingsStoreReporter = (message: string, ...details: readonly unknown[]) => void

export interface KeybindingsStoreOptions {
  readonly onIssue?: KeybindingsStoreReporter
  /** 退避ファイル名に使う時刻（テストで固定するため）。 */
  readonly now?: () => Date
}

export function createKeybindingsStore(
  directory: string,
  options: KeybindingsStoreOptions = {}
): KeybindingsStore {
  const filePath = join(directory, KEYBINDINGS_FILE_NAME)
  const report = options.onIssue ?? ((): void => {})
  const now = options.now ?? ((): Date => new Date())

  const writer = createJsonFileWriter(filePath, (cause) => {
    // 保存に失敗してもアプリの動作は継続する。次回起動時は前の内容で始まるだけで済む。
    report(`failed to write "${KEYBINDINGS_FILE_NAME}".`, cause)
  })

  let current: LoadKeybindingsResponse | null = null

  function load(): LoadKeybindingsResponse {
    const found = readJsonFile(filePath)

    if (found.kind === 'missing') {
      return { status: 'missing', entries: [], skippedCount: 0 }
    }

    if (found.kind === 'unreadable') {
      report(
        `failed to read "${KEYBINDINGS_FILE_NAME}"; using the default keybindings.`,
        found.cause
      )
      return { status: 'unreadable', entries: [], skippedCount: 0 }
    }

    const parsed = parseKeybindingsFile(found.raw)

    if (parsed === null) {
      report(`"${KEYBINDINGS_FILE_NAME}" is not an array; using the default keybindings.`)
      return { status: 'unreadable', entries: [], skippedCount: 0 }
    }

    if (parsed.skippedCount > 0) {
      report(
        `"${KEYBINDINGS_FILE_NAME}": skipped ${String(parsed.skippedCount)} entries that are not in a readable shape.`
      )
    }

    return { status: 'loaded', entries: parsed.entries, skippedCount: parsed.skippedCount }
  }

  function read(): LoadKeybindingsResponse {
    current ??= load()
    return current
  }

  /** 壊れたファイルを残す。失敗したら false（その場合は上書きしない）。 */
  function backUpUnreadableFile(): boolean {
    const backupName = `keybindings.broken-${timestamp(now())}.json`

    try {
      renameSync(filePath, join(directory, backupName))
      report(`moved the unreadable "${KEYBINDINGS_FILE_NAME}" to "${backupName}" before saving.`)
      return true
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        // 起動後に利用者が消した。残すものが無いので、そのまま書いてよい。
        return true
      }

      report(`failed to back up the unreadable "${KEYBINDINGS_FILE_NAME}"; not saving.`, cause)
      return false
    }
  }

  return {
    read,

    save(entries: readonly StoredKeybindingEntry[]): void {
      if (read().status === 'unreadable' && !backUpUnreadableFile()) {
        /*
          退避できないまま書くと、利用者の手書きの内容が消える。
          メモリの側も差し替えない ── 「保存された」ように見せないため。
        */
        return
      }

      current = { status: 'loaded', entries: [...entries], skippedCount: 0 }
      writer.save(entries)
    },

    flush(): void {
      writer.flush()
    }
  }
}

/** `20260917-213045`（ファイル名に使える、並べると時刻順になる形）。 */
function timestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')

  return (
    `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}
