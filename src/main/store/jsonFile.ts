import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * JSON ファイル1つの読み書き（Electron に依存しない）。
 *
 * `jsonStore.ts` から**保存先の決め方（userData）とログだけを外した**部分にあたる。
 * 切り出したのは Session 4-3A で、理由は2つ。
 *
 *  1. 設定の読み込みは「無い」と「壊れている」を区別する必要がある
 *     （無いときだけ旧ファイルからの移行を試みる。store/settingsStore.ts）。
 *     `JsonStore.read()` はどちらも `null` になるため、区別できない。
 *  2. 実際のディスクを使ったテストを書きたい。`electron` を import する層は
 *     Vitest（node 環境）から読み込めない。
 *
 * ここは fs しか知らないので、**保存先も、失敗したときに何を言うかも決めない** ──
 * それは呼ぶ側（jsonStore.ts / settings.ts）の仕事になる。
 */

/** 読み込みの結果。「無い」と「壊れている」を呼ぶ側が区別できる形にする。 */
export type JsonFileRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly cause: unknown }
  | { readonly kind: 'present'; readonly raw: unknown }

/**
 * JSON ファイルを読む。
 *
 * 初回起動でファイルが無いのは正常な状態であって失敗ではない。
 * JSON として読めない場合（手で編集した・書き込み中に落ちた）は `unreadable` を返し、
 * どう扱うかは呼ぶ側が決める。
 */
export function readJsonFile(filePath: string): JsonFileRead {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing' }
    }
    return { kind: 'unreadable', cause }
  }

  try {
    return { kind: 'present', raw: JSON.parse(text) }
  } catch (cause) {
    return { kind: 'unreadable', cause }
  }
}

/**
 * JSON ファイルを書く（原子的な差し替え）。
 *
 * 書き込み中に落ちても既存ファイルを壊さないよう、一時ファイルへ書いてから
 * rename する。失敗しても投げずに false を返す ── 設定やレイアウトの保存が
 * できないことは、アプリを止める理由にならない。
 */
export function writeJsonFile(
  filePath: string,
  value: unknown
): { readonly ok: boolean; readonly cause?: unknown } {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(tempPath, filePath)
    return { ok: true }
  } catch (cause) {
    return { ok: false, cause }
  }
}

/** 書き込みを間引く間隔。ウィンドウのリサイズのように高頻度で呼ばれる用途を想定している。 */
export const JSON_WRITE_DELAY_MS = 400

export interface JsonFileWriter {
  /** 書き込みを予約する。連続呼び出しは最後の1回にまとめられる。 */
  save(value: unknown): void
  /** 予約済みの書き込みを即座に反映する。終了直前など、待てない場面で使う。 */
  flush(): void
}

/**
 * 間引き付きの書き込み口を作る。
 *
 * @param filePath 書き込み先（絶対パス）
 * @param onError  書き込みに失敗したときの通知。ログの言い回しは呼ぶ側が持つ
 *                 （このファイルは Electron も logger も知らない）。
 */
export function createJsonFileWriter(
  filePath: string,
  onError?: (cause: unknown) => void
): JsonFileWriter {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { readonly value: unknown } | null = null

  function writeNow(value: unknown): void {
    const result = writeJsonFile(filePath, value)
    if (!result.ok) {
      onError?.(result.cause)
    }
  }

  return {
    save(value: unknown): void {
      pending = { value }
      if (timer !== null) {
        return
      }
      timer = setTimeout(() => {
        timer = null
        const target = pending
        pending = null
        if (target !== null) {
          writeNow(target.value)
        }
      }, JSON_WRITE_DELAY_MS)
    },

    flush(): void {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      const target = pending
      pending = null
      if (target !== null) {
        writeNow(target.value)
      }
    }
  }
}
