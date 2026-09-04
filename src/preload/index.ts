import { contextBridge } from 'electron'
import { FLUVIX_API_KEY } from '@shared/api'
import { api } from './api'
import { applyInitialLanguage } from './language'
import { applyInitialTheme } from './theme'

/**
 * contextIsolation を有効にした状態で、Renderer の window に API を公開する。
 *
 * 公開されるのは shared/api.ts の FluvixApi で定義されたものだけであり、
 * Electron / Node.js のオブジェクトをそのまま渡すことはしない。
 *
 * Session 4-4 で、公開とは別に**保存済み Theme を `<html>` へ当てる**処理が
 * 加わった（theme.ts）。API は1つも増えていない ── Renderer から見えるものは
 * 何も変わらず、増えたのは最初の描画より前に属性を1つ当てる処理だけにあたる。
 */

/*
  API の公開より先に置く。Theme を当てるのは早ければ早いほどよく（HTML の解析が
  始まる前に見張りを掛けたい）、こちらは Renderer が動き出すまで使われない。
*/
applyInitialTheme()
applyInitialLanguage()

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld(FLUVIX_API_KEY, api)
} else {
  // contextIsolation は必ず有効にする前提のため、無効な状態は設定ミスとして扱う。
  throw new Error(
    'contextIsolation is disabled. Fluvix Nexus requires contextIsolation to expose its API safely.'
  )
}
