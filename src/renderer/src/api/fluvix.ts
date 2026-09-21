import type { FluvixApi } from '@shared/api'

/**
 * Renderer から Preload API へアクセスする唯一の入り口。
 *
 * UI コンポーネントが window を直接参照すると、Renderer と実行環境の結合が
 * コード全体に広がってしまう。参照点をこのモジュールに一本化することで、
 * 「Renderer は OS に触れない」という境界をコード上でも維持する。
 *
 * **読み込み時ではなく、呼ばれた時点で window を見る。** Panel Registry から辿れる範囲に
 * IPC を呼ぶパネル（Files 以降）が入ったため、レイアウトの純粋なロジックを試すだけの
 * ユニットテスト（node 環境）からもこのモジュールが読み込まれる。
 * 読み込むだけで落ちる形にしておくと、IPC を呼んでいないテストまで環境の都合で書けなくなる。
 */

function bridge(): FluvixApi {
  const api = (globalThis as { fluvix?: FluvixApi }).fluvix

  if (api === undefined) {
    // Preload が動いていない環境。呼んだ時点で初めて分かる方が原因を追いやすい。
    throw new Error('window.fluvix is not available (the preload bridge did not run).')
  }

  return api
}

export const fluvix: FluvixApi = {
  get env() {
    return bridge().env
  },
  get system() {
    return bridge().system
  },
  get window() {
    return bridge().window
  },
  get workspace() {
    return bridge().workspace
  },
  get workspaceFolder() {
    return bridge().workspaceFolder
  },
  get files() {
    return bridge().files
  },
  get terminal() {
    return bridge().terminal
  },
  get git() {
    return bridge().git
  },
  get github() {
    return bridge().github
  },
  get updates() {
    return bridge().updates
  },
  get lsp() {
    return bridge().lsp
  },
  get debug() {
    return bridge().debug
  },
  get settings() {
    return bridge().settings
  },
  get feedback() {
    return bridge().feedback
  }
}
