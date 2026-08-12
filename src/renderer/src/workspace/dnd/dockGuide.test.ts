import { describe, expect, it } from 'vitest'
import { resolveDockZone } from './dockGuide'
import type { DragAreaRect } from './types'

/**
 * カーソル位置から DockZone を決める判定の検証。
 *
 * ドラッグ&ドロップで最も体感に響くのがこの判定（中央のつもりが分割される、
 * 角でどちらに落ちるか分からない）なので、実際にマウスを動かさずに確かめられる形にしてある。
 */

/** 800x400 の領域。端の帯は 800*0.3 = 240 → 上限 120px、400*0.3 = 120px。 */
const AREA: DragAreaRect = { left: 100, top: 50, width: 800, height: 400 }

function zoneAt(x: number, y: number, rect: DragAreaRect = AREA) {
  return resolveDockZone(rect, { x: rect.left + x, y: rect.top + y })
}

describe('resolveDockZone', () => {
  it('中心は center', () => {
    expect(zoneAt(400, 200)).toBe('center')
  })

  it('各辺の帯に入ると、その辺の DockSide になる', () => {
    expect(zoneAt(20, 200)).toBe('left')
    expect(zoneAt(780, 200)).toBe('right')
    expect(zoneAt(400, 20)).toBe('top')
    expect(zoneAt(400, 380)).toBe('bottom')
  })

  it('帯の外側は center（帯は上限 120px で頭打ちになる）', () => {
    // 領域幅の 30% は 240px だが、上限があるため 130px はもう中央。
    expect(zoneAt(130, 200)).toBe('center')
    expect(zoneAt(110, 200)).toBe('left')
  })

  it('角では、帯への入り込みが深い辺が勝つ', () => {
    // 左上の角。x/bandX < y/bandY なら left。
    expect(zoneAt(10, 40)).toBe('left')
    expect(zoneAt(60, 10)).toBe('top')
    // 右下の角も同じ扱い。
    expect(zoneAt(790, 360)).toBe('right')
    expect(zoneAt(740, 390)).toBe('bottom')
  })

  it('小さい領域でも中央が残る（帯は短辺の割合で決まる）', () => {
    const small: DragAreaRect = { left: 0, top: 0, width: 100, height: 100 }

    expect(zoneAt(50, 50, small)).toBe('center')
    expect(zoneAt(5, 50, small)).toBe('left')
    expect(zoneAt(50, 95, small)).toBe('bottom')
  })

  it('領域の外なら null', () => {
    expect(resolveDockZone(AREA, { x: 99, y: 200 })).toBeNull()
    expect(resolveDockZone(AREA, { x: 901, y: 200 })).toBeNull()
    expect(resolveDockZone(AREA, { x: 400, y: 49 })).toBeNull()
    expect(resolveDockZone(AREA, { x: 400, y: 451 })).toBeNull()
  })

  it('辺の上はまだ領域の内側として扱う', () => {
    expect(zoneAt(0, 0)).toBe('left')
    expect(zoneAt(800, 400)).toBe('right')
  })

  it('大きさを持たない領域は判定しない（描画されていない領域を拾わない）', () => {
    expect(resolveDockZone({ left: 0, top: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBeNull()
  })
})
