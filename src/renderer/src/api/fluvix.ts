import type { FluvixApi } from '@shared/api'

/**
 * Renderer から Preload API へアクセスする唯一の入り口。
 *
 * UI コンポーネントが window を直接参照すると、Renderer と実行環境の結合が
 * コード全体に広がってしまう。参照点をこのモジュールに一本化することで、
 * 「Renderer は OS に触れない」という境界をコード上でも維持する。
 */
export const fluvix: FluvixApi = window.fluvix
