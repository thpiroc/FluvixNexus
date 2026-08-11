import { contextBridge } from 'electron'
import { FLUVIX_API_KEY } from '@shared/api'
import { api } from './api'

/**
 * contextIsolation を有効にした状態で、Renderer の window に API を公開する。
 *
 * 公開されるのは shared/api.ts の FluvixApi で定義されたものだけであり、
 * Electron / Node.js のオブジェクトをそのまま渡すことはしない。
 */
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld(FLUVIX_API_KEY, api)
} else {
  // contextIsolation は必ず有効にする前提のため、無効な状態は設定ミスとして扱う。
  throw new Error(
    'contextIsolation is disabled. Fluvix Nexus requires contextIsolation to expose its API safely.'
  )
}
