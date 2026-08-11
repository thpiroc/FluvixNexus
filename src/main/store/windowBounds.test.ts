import { describe, expect, it } from 'vitest'
import { isBoundsVisible, parseWindowState, type WindowBounds } from './windowBounds'

const PRIMARY_DISPLAY: WindowBounds = { x: 0, y: 0, width: 1920, height: 1040 }

describe('parseWindowState', () => {
  it('保存された状態をそのまま復元する', () => {
    const state = { bounds: { x: 100, y: 50, width: 1280, height: 800 }, isMaximized: true }

    expect(parseWindowState(state)).toEqual(state)
  })

  it('形が違う値は受け付けない', () => {
    expect(parseWindowState(null)).toBeNull()
    expect(parseWindowState('{}')).toBeNull()
    expect(parseWindowState({})).toBeNull()
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 1280, height: 800 } })).toBeNull()
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 1280 }, isMaximized: false })).toBeNull()
  })

  it('数値でない・整数でない座標は受け付けない', () => {
    const bounds = { x: '0', y: 0, width: 1280, height: 800 }

    expect(parseWindowState({ bounds, isMaximized: false })).toBeNull()
    expect(
      parseWindowState({ bounds: { x: 0.5, y: 0, width: 1280, height: 800 }, isMaximized: false })
    ).toBeNull()
  })

  it('最小サイズを下回るサイズは受け付けない', () => {
    expect(
      parseWindowState({ bounds: { x: 0, y: 0, width: 320, height: 240 }, isMaximized: false })
    ).toBeNull()
  })
})

describe('isBoundsVisible', () => {
  it('画面内に収まっているウィンドウは表示できる', () => {
    const bounds: WindowBounds = { x: 100, y: 100, width: 1280, height: 800 }

    expect(isBoundsVisible(bounds, [PRIMARY_DISPLAY])).toBe(true)
  })

  it('一部だけ画面にかかっているウィンドウも表示できる', () => {
    const bounds: WindowBounds = { x: 1700, y: 900, width: 1280, height: 800 }

    expect(isBoundsVisible(bounds, [PRIMARY_DISPLAY])).toBe(true)
  })

  it('外部モニタを外した後のように、画面外へ出た位置は表示できない', () => {
    const onRemovedDisplay: WindowBounds = { x: 2200, y: 200, width: 1280, height: 800 }

    expect(isBoundsVisible(onRemovedDisplay, [PRIMARY_DISPLAY])).toBe(false)
  })

  it('掴めないほどわずかな重なりは表示できないものとして扱う', () => {
    // 右端に 20px だけ残っている状態。タイトルバーを掴めないため復元しない。
    const barelyVisible: WindowBounds = { x: 1900, y: 100, width: 1280, height: 800 }

    expect(isBoundsVisible(barelyVisible, [PRIMARY_DISPLAY])).toBe(false)
  })

  it('複数ディスプレイのいずれかに収まっていればよい', () => {
    const secondaryDisplay: WindowBounds = { x: 1920, y: 0, width: 1920, height: 1040 }
    const onSecondary: WindowBounds = { x: 2200, y: 200, width: 1280, height: 800 }

    expect(isBoundsVisible(onSecondary, [PRIMARY_DISPLAY, secondaryDisplay])).toBe(true)
  })
})
