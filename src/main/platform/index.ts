import type { PlatformId } from '@shared/api'

/**
 * OS 依存の判定を集約するレイヤー。
 *
 * DESIGN.md §8 の方針どおり、OS 固有の分岐は Main Process のこの層に閉じ込め、
 * Renderer / UI ロジックからは一切参照しない。
 * シェル起動コマンドや通知 API などの OS 固有実装も、将来的にはここへ集約する。
 */
export const currentPlatform = process.platform as PlatformId

export const isWindows = currentPlatform === 'win32'
export const isMacOS = currentPlatform === 'darwin'
