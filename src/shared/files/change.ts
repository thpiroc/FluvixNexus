/**
 * Workspace の中で起きたファイルの変化。
 *
 * Main → Renderer のイベント（shared/ipc/events/files.ts）で運ぶ値であり、
 * 要求と応答（IpcContract）とは別の経路を通る。
 *
 * ## なぜ応答ではなくイベントなのか
 *
 * 作成・リネーム・削除は Renderer からの要求で起きるため、結果を応答に載せることもできる。
 * それでもイベントにしているのは、**変化を知る必要がある側と、操作した側が違う**ため。
 *
 *   Files パネル … 親フォルダを読み直す
 *   Editor       … 開いているタブの位置を追従させる / 消えたタブを閉じる
 *
 * 応答で配ると、操作した箇所（Files のコンテキストメニュー）が Editor の都合まで
 * 知ることになる。イベントにしておけば、受け取る側が増えても送る側は変わらない。
 *
 * **同じ形をアプリの外での変更（main/files/workspaceWatcher.ts）からも流す。**
 * 監視には「誰の操作か」が無く、複数の変化がまとめて届くため、
 * 単数ではなく配列で運び、原因も持たせない。どこから来た変化かは
 * イベント側の `source`（events/files.ts）が持ち、変化1件の形は同じにしてある。
 *
 * ## 位置はすべて相対位置
 *
 * 絶対パスは載せない。監視は OS から絶対パスで届くが、Renderer へ渡す前に
 * Workspace root からの相対位置へ落とす（Renderer は絶対パスを持たない。
 * ARCHITECTURE.md §9.2）。Workspace の外を指すものは、そもそも変化として配らない。
 */

import type { FileEntryType } from './entry'
import type { FileRevision } from './content'

/** 変化の種類。 */
export type WorkspaceFileChangeKind = 'created' | 'modified' | 'deleted' | 'renamed'

/** 変化1件。位置はすべて Workspace root からの相対位置（区切りは `/`）。 */
export type WorkspaceFileChange =
  | {
      readonly kind: 'created'
      readonly relativePath: string
      readonly entryType: FileEntryType
    }
  | {
      /**
       * 中身が書き換わった。
       *
       * **ツリーの形は変わらない**ため、Files パネルはこの変化で読み直さない
       * （renderer/src/files/fileChanges.ts）。受け取るのは中身を持っている側
       * ＝ Editor だけになる。
       *
       * フォルダに対しては出さない。フォルダの「変更」は中身の増減であり、
       * それは配下の created / deleted として別に届く。
       */
      readonly kind: 'modified'
      readonly relativePath: string
      readonly entryType: 'file'
      /**
       * 書き換わった後の版（shared/files/content.ts）。
       *
       * 受け手はこれを「自分が最後にディスクで見た版」と突き合わせ、
       * **同じなら何もしない。** アプリ自身の保存でも監視は発火するため、
       * これが無いと保存のたびに「外部で変更された」と誤って判断することになる。
       */
      readonly revision: FileRevision
    }
  | {
      readonly kind: 'deleted'
      readonly relativePath: string
      /**
       * 何が消えたか。**消えた後では分からない場合がある**ため null を許す。
       *
       * アプリの中の削除（files:delete）は消す前に種別を確かめているので必ず入るが、
       * 監視から気づいた削除では既に無い。種別が要る判断はどこにも無く
       * （配下を畳むのは種別ではなく位置で決まる）、
       * **知らないことを 'file' と偽らない**方を採る。
       */
      readonly entryType: FileEntryType | null
    }
  | {
      /**
       * 位置が変わった。
       *
       * アプリの中の改名（files:rename）はこの形で届く。**アプリの外での改名は
       * OS からは「消えた」「現れた」としてしか届かない**ため、監視からは
       * deleted と created の組として配る（対応付けを推測すると、
       * 別々に起きた削除と作成を1つの改名として扱う誤りが起きる）。
       * 受け手の扱いを分けられるよう、種別としては最初から持たせてある。
       */
      readonly kind: 'renamed'
      readonly fromRelativePath: string
      readonly toRelativePath: string
      readonly entryType: FileEntryType
    }
