import { app } from 'electron'

/**
 * 実行モードの判定を集約するモジュール。
 *
 * 「開発中か / 配布ビルドか」「Renderer をどこから読み込むか」は、
 * ウィンドウ生成・セキュリティポリシー・メニュー構成など複数の箇所が参照する。
 * 判定式を各所に散らすと条件がずれていくため、ここ1箇所に固定する。
 *
 * OS の違いによる分岐は platform/ の責務であり、このモジュールは扱わない。
 */

/** 開発中（electron-vite dev / 未パッケージ実行）かどうか。 */
export const isDevelopment = !app.isPackaged

/**
 * 開発時のみ electron-vite が渡す Vite dev server の URL。
 * 配布ビルドでは undefined になり、ビルド済みの HTML を読み込む。
 */
export const devServerUrl = process.env['ELECTRON_RENDERER_URL']
