import { describe, expect, it } from 'vitest'
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_STEP_PX,
  computeAutoScrollDelta
} from './filesAutoScroll'

/**
 * ドラッグ中の自動スクロールの計算（Session 3-6-8）。
 *
 * 確かめるのは4つ。
 *   - **真ん中では動かないこと**（指しているだけで流れない）
 *   - 縁に近づくと、その向きへ動くこと（手前は負・奥は正）
 *   - **器の外では動かないこと**（落とせない場所で中身を流さない）
 *   - 縁に近いほど速く、上限を超えないこと
 */

const rect = { left: 0, top: 0, right: 400, bottom: 300 }

describe('computeAutoScrollDelta', () => {
  it('真ん中では動かない', () => {
    expect(computeAutoScrollDelta(rect, { x: 200, y: 150 })).toEqual({ x: 0, y: 0 })
  })

  it('上の縁に近いと上へ、下の縁に近いと下へ動く', () => {
    expect(computeAutoScrollDelta(rect, { x: 200, y: 4 }).y).toBeLessThan(0)
    expect(computeAutoScrollDelta(rect, { x: 200, y: 296 }).y).toBeGreaterThan(0)
  })

  it('左の縁に近いと左へ、右の縁に近いと右へ動く', () => {
    expect(computeAutoScrollDelta(rect, { x: 4, y: 150 }).x).toBeLessThan(0)
    expect(computeAutoScrollDelta(rect, { x: 396, y: 150 }).x).toBeGreaterThan(0)
  })

  /*
    縦と横は独立に決まる。カラム表示では横は器・縦はカラムの中が動くため、
    片方だけが動く場面が普通にある。
  */
  it('縦と横は独立に決まる', () => {
    const corner = computeAutoScrollDelta(rect, { x: 4, y: 4 })

    expect(corner.x).toBeLessThan(0)
    expect(corner.y).toBeLessThan(0)

    const sideOnly = computeAutoScrollDelta(rect, { x: 4, y: 150 })

    expect(sideOnly.x).toBeLessThan(0)
    expect(sideOnly.y).toBe(0)
  })

  it('器の外では動かない（落とせない場所で中身を流さない）', () => {
    for (const point of [
      { x: -10, y: 150 },
      { x: 410, y: 150 },
      { x: 200, y: -10 },
      { x: 200, y: 310 }
    ]) {
      expect(computeAutoScrollDelta(rect, point)).toEqual({ x: 0, y: 0 })
    }
  })

  it('帯のすぐ内側では動かず、入った時点で必ず動く', () => {
    expect(computeAutoScrollDelta(rect, { x: 200, y: AUTO_SCROLL_EDGE_PX }).y).toBe(0)
    expect(
      computeAutoScrollDelta(rect, { x: 200, y: AUTO_SCROLL_EDGE_PX - 1 }).y
    ).toBeLessThanOrEqual(-1)
  })

  it('縁に近いほど速く、上限を超えない', () => {
    const near = computeAutoScrollDelta(rect, { x: 200, y: 1 }).y
    const far = computeAutoScrollDelta(rect, { x: 200, y: AUTO_SCROLL_EDGE_PX - 2 }).y

    expect(near).toBeLessThan(far)
    expect(Math.abs(near)).toBeLessThanOrEqual(AUTO_SCROLL_MAX_STEP_PX)
    expect(computeAutoScrollDelta(rect, { x: 200, y: 0 }).y).toBe(-AUTO_SCROLL_MAX_STEP_PX)
  })

  /*
    縁の幅の2倍より狭い器（短いカラム）では両側の帯が重なる。
    重なりを禁じると、狭い器では自動スクロールがまったく効かなくなる。
  */
  it('狭い器では近い方の縁が勝つ', () => {
    const narrow = { left: 0, top: 0, right: 400, bottom: 30 }

    expect(computeAutoScrollDelta(narrow, { x: 200, y: 2 }).y).toBeLessThan(0)
    expect(computeAutoScrollDelta(narrow, { x: 200, y: 28 }).y).toBeGreaterThan(0)
  })

  it('速さの決め方は差し替えられる（テストと調整のため）', () => {
    expect(computeAutoScrollDelta(rect, { x: 200, y: 0 }, { edge: 50, maxStep: 4 }).y).toBe(-4)
  })
})
