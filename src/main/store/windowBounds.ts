/**
 * ウィンドウ状態の値と、その検証ロジック。
 *
 * このファイルは Electron に依存しない純粋な関数だけを持つ。
 * 「保存された値が信用できるか」「その位置に本当にウィンドウを出してよいか」という判断は、
 * ディスプレイ構成が変わったときの不具合（画面外にウィンドウが出て掴めない）に直結するため、
 * 実行環境なしで単体テストできる形に切り出してある。
 *
 * Electron の API を使う側は store/windowState.ts。
 */

export interface WindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WindowState {
  readonly bounds: WindowBounds
  readonly isMaximized: boolean
}

/** 初回起動時のウィンドウサイズ。位置は指定せず OS 標準の配置に任せる。 */
export const DEFAULT_WINDOW_SIZE = {
  width: 1280,
  height: 800
} as const

/**
 * ウィンドウの最小サイズ。
 * 4 つのパネルを並べる前提のアプリのため、これ以上小さくしても実用にならない。
 */
export const MINIMUM_WINDOW_SIZE = {
  width: 800,
  height: 600
} as const

/**
 * 復元を許可するために必要な、ディスプレイとの重なり。
 * 少なくともタイトルバーを掴める程度が画面内にあることを条件とする。
 */
const REQUIRED_VISIBLE_AREA = {
  width: 120,
  height: 60
} as const

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function parseBounds(raw: unknown): WindowBounds | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  const { x, y, width, height } = raw as Record<string, unknown>

  if (
    !isFiniteInteger(x) ||
    !isFiniteInteger(y) ||
    !isFiniteInteger(width) ||
    !isFiniteInteger(height)
  ) {
    return null
  }

  // 最小サイズを下回る値は、保存時の異常か手編集によるもの。既定値へ戻す。
  if (width < MINIMUM_WINDOW_SIZE.width || height < MINIMUM_WINDOW_SIZE.height) {
    return null
  }

  return { x, y, width, height }
}

/** 保存ファイルの内容を検証する。想定外なら null を返し、呼び出し側は既定値を使う。 */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  const { bounds, isMaximized } = raw as Record<string, unknown>

  const parsedBounds = parseBounds(bounds)
  if (parsedBounds === null || typeof isMaximized !== 'boolean') {
    return null
  }

  return { bounds: parsedBounds, isMaximized }
}

function overlapArea(a: WindowBounds, b: WindowBounds): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/**
 * 保存された位置が、現在のディスプレイ構成で見える場所にあるか。
 *
 * 外部モニタを外した後や解像度変更後に、前回の位置をそのまま使うと
 * ウィンドウが画面外に出て操作できなくなる。その場合は位置を捨ててサイズだけ引き継ぐ。
 *
 * @param areas 各ディスプレイの作業領域（タスクバーを除いた領域）
 */
export function isBoundsVisible(bounds: WindowBounds, areas: readonly WindowBounds[]): boolean {
  return areas.some((area) => {
    const overlap = overlapArea(bounds, area)
    return (
      overlap.width >= REQUIRED_VISIBLE_AREA.width && overlap.height >= REQUIRED_VISIBLE_AREA.height
    )
  })
}
