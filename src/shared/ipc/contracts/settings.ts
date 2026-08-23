import type { EditorSettingsDocument } from '../../settings/editorSettings'
import type { FilesSettingsDocument } from '../../settings/filesSettings'
import type { TerminalSettingsDocument } from '../../settings/terminalSettings'

/**
 * settings ドメインの IPC 契約（アプリの設定の永続化）。
 *
 * ## 用途専用の API にする
 *
 * `workspace:save-layout` と同じ形で、**保存先のパスもファイル名も Renderer からは
 * 指定できない**（main/store/editorSettings.ts が決める）。汎用の
 * 「JSON を1つ保存する」API を公開すると、Renderer を OS から切り離している前提が
 * そこで崩れる（ARCHITECTURE.md §5）。
 *
 * そのため、別のものを保存したくなったらこのドメインに**チャンネルを足す**形にする。
 * Editor の設定（Auto Save）・Files の見え方（Session 3-6-8）・Terminal の見え方
 * （Session 3-7-5）はそれぞれ別のチャンネル・別のファイルで、Git の設定が要るように
 * なったら同じ形で増やす。**既にあるチャンネルへ相乗りさせない** ── 相乗りを1つ
 * 許した時点で「Editor の設定」という限定が消え、保存の失敗が無関係な機能へ波及する。
 *
 * ## 読めなければ既定で始める
 *
 * 保存が無い / 壊れている場合は `document: null` を返す。失敗にしないのは、
 * 設定が読めないことがアプリを使えない理由にならないため（レイアウトと同じ扱い）。
 * 知らない mode などの**中身の解釈**は Renderer 側（editor/autoSave.ts）が行い、
 * Main は「後で解釈できる形か」だけを見る。
 */

export interface LoadEditorSettingsResponse {
  /** 保存済みの設定。未保存・破損・想定外の内容なら null（＝既定で始める）。 */
  readonly document: EditorSettingsDocument | null
}

export interface SaveEditorSettingsRequest {
  readonly document: EditorSettingsDocument
}

export interface LoadFilesSettingsResponse {
  /** 保存済みの設定。未保存・破損・想定外の内容なら null（＝既定で始める）。 */
  readonly document: FilesSettingsDocument | null
}

export interface SaveFilesSettingsRequest {
  readonly document: FilesSettingsDocument
}

export interface LoadTerminalSettingsResponse {
  /** 保存済みの設定。未保存・破損・想定外の内容なら null（＝既定で始める）。 */
  readonly document: TerminalSettingsDocument | null
}

export interface SaveTerminalSettingsRequest {
  readonly document: TerminalSettingsDocument
}

export interface SettingsIpcContract {
  'settings:load-editor': {
    request: void
    response: LoadEditorSettingsResponse
  }
  'settings:save-editor': {
    request: SaveEditorSettingsRequest
    response: void
  }
  'settings:load-files': {
    request: void
    response: LoadFilesSettingsResponse
  }
  'settings:save-files': {
    request: SaveFilesSettingsRequest
    response: void
  }
  'settings:load-terminal': {
    request: void
    response: LoadTerminalSettingsResponse
  }
  'settings:save-terminal': {
    request: SaveTerminalSettingsRequest
    response: void
  }
}
