import {
  IPC_CHANNELS,
  type LoadEditorSettingsResponse,
  type LoadFilesSettingsResponse
} from '@shared/ipc'
import { readEditorSettingsDocument, saveEditorSettingsDocument } from '../../store/editorSettings'
import { parseEditorSettingsDocument } from '../../store/editorSettingsDocument'
import { readFilesSettingsDocument, saveFilesSettingsDocument } from '../../store/filesSettings'
import { parseFilesSettingsDocument } from '../../store/filesSettingsDocument'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * settings ドメインのハンドラ（アプリの設定の永続化）。
 *
 * workspace ドメイン（レイアウトの読み書き）と同じ形で、どのチャンネルも持つのは2つだけ。
 *   - 保存先を Main 側で決める（Renderer からはパスもファイル名も指定できない）
 *   - 届いた文書が**後で読める形か**を確かめてから書く
 *
 * ## 用途ごとに読み書きの対を足す
 *
 * Editor の設定（Auto Save）と Files の見え方（表示方式・カラムの幅。Session 3-6-8）は
 * **別のチャンネル・別のファイル・別の検証**にしてある。同じ形が2つ並ぶが、
 * 1つにまとめると保存先が用途で切れなくなり、片方の保存の失敗がもう片方を巻き込む
 * （ARCHITECTURE.md §5）。
 *
 * ## 読めなくても失敗にしない
 *
 * 保存が無い / 壊れている場合は `document: null` を返す。設定が読めないことは
 * アプリを使えない理由にならず、Renderer は既定（Auto Save は OFF、Files の
 * 表示方式はパネルの形に任せる）で始まる。
 *
 * ## 書く前に必ず検証する
 *
 * Renderer から届く値も境界の外から来たものとして扱う
 * （ARCHITECTURE.md §5「永続化の API を用途ごとに切る」）。想定外の内容や
 * 桁違いの大きさをそのままディスクに残さない。**中身の意味**（mode として
 * 成立するか）は見ない ── それを知っているのは Renderer だけで、
 * 二重に解釈すると「どちらが正しいか」が生まれる。
 */
export function registerSettingsHandlers(): void {
  handleIpc(IPC_CHANNELS.SETTINGS_LOAD_EDITOR, (): LoadEditorSettingsResponse => {
    return { document: readEditorSettingsDocument() }
  })

  handleIpc(IPC_CHANNELS.SETTINGS_SAVE_EDITOR, (request): void => {
    const document = parseEditorSettingsDocument(documentOf(request))

    if (document === null) {
      throw invalidRequest('the editor settings document is not in a storable shape.')
    }

    saveEditorSettingsDocument(document)
  })

  handleIpc(IPC_CHANNELS.SETTINGS_LOAD_FILES, (): LoadFilesSettingsResponse => {
    return { document: readFilesSettingsDocument() }
  })

  handleIpc(IPC_CHANNELS.SETTINGS_SAVE_FILES, (request): void => {
    const document = parseFilesSettingsDocument(documentOf(request))

    if (document === null) {
      throw invalidRequest('the files settings document is not in a storable shape.')
    }

    saveFilesSettingsDocument(document)
  })
}

/**
 * 要求から文書を取り出す。
 *
 * 要求そのものも境界の外から来た値なので、`document` を読む前に器の形を確かめる。
 * **中身を見るのはここではない** ── 何が文書として成立するかは、その用途の
 * parse 関数（store/*Document.ts）だけが知っている。
 */
function documentOf(request: unknown): unknown {
  return typeof request === 'object' && request !== null
    ? (request as { document?: unknown }).document
    : undefined
}
