import { app } from 'electron'
import { join } from 'path'
import { createLogger } from '../logger'
import { createJsonFileWriter, readJsonFile } from './jsonFile'

/**
 * ユーザー領域（userData）配下の JSON ファイルへ状態を保存する最小のストア。
 *
 * ウィンドウ状態・レイアウトプリセット・Workspace は、いずれも
 * 「小さな JSON を1つ読み書きするだけ」という同じ形をしている。
 * その共通部分（保存先の決定・壊れたファイルの扱い・書き込みの間引き・原子的な差し替え）を
 * ここにまとめ、利用側は「何を保存するか」と「読み込んだ値が正しいか」だけを持つ。
 *
 * 保存先は app.getPath('userData')（Windows では %APPDATA%/<アプリ名>）配下とし、
 * アプリの配置場所やインストール形態に依存しないようにする。
 *
 * ファイルそのものの読み書きは `jsonFile.ts` にある（Electron 非依存・テスト対象）。
 * **ここに残っているのは「保存先の決め方」と「失敗したときに何を言うか」だけ**で、
 * 設定（store/settings.ts）のように読み込みの分岐を自分で持つ側は
 * `jsonFile.ts` を直に使う。
 *
 * 設計上の前提:
 *  - 保存対象は数 KB 程度の小さな状態に限る。大きなデータはこのストアで扱わない。
 *  - 同時に複数プロセスから書かれないこと（単一インスタンス制御が前提。lifecycle.ts 参照）。
 */

const log = createLogger('store')

export interface JsonStore<T> {
  /** 保存済みの値。未保存・破損・想定外の内容の場合は null を返す。 */
  read(): T | null
  /** 値の保存を予約する。連続呼び出しは最後の1回にまとめられる。 */
  save(value: T): void
  /** 予約済みの書き込みを即座に反映する。終了直前など、待てない場面で使う。 */
  flush(): void
}

/** userData 配下のファイルの絶対パス。保存先を決めるのはこの1箇所だけにする。 */
export function userDataFilePath(fileName: string): string {
  return join(app.getPath('userData'), fileName)
}

/**
 * JSON ストアを作る。
 *
 * @param fileName userData 配下のファイル名（例: 'window-state.json'）
 * @param parse    読み込んだ値の検証。想定外の内容なら null を返すこと。
 *                 ファイルは利用者が手で編集できる場所にあり、アプリのバージョン差で
 *                 形が変わることもあるため、読み込み側で必ず検証する。
 */
export function createJsonStore<T>(
  fileName: string,
  parse: (raw: unknown) => T | null
): JsonStore<T> {
  const filePath = userDataFilePath(fileName)

  const writer = createJsonFileWriter(filePath, (cause) => {
    // 保存に失敗してもアプリの動作は継続する。次回起動時に既定値へ戻るだけで済むため。
    log.error(`failed to write "${fileName}".`, cause)
  })

  return {
    read(): T | null {
      const found = readJsonFile(filePath)

      // 初回起動ではファイルが無いのが正常なので、その場合はログを出さない。
      if (found.kind === 'missing') {
        return null
      }

      if (found.kind === 'unreadable') {
        log.warn(`failed to read "${fileName}"; falling back to defaults.`, found.cause)
        return null
      }

      const value = parse(found.raw)
      if (value === null) {
        log.warn(`ignored unexpected contents of "${fileName}"; falling back to defaults.`)
      }
      return value
    },

    save(value: T): void {
      writer.save(value)
    },

    flush(): void {
      writer.flush()
    }
  }
}
