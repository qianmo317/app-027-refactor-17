import { describe, expect, it } from 'vitest'
import type { Shape } from '@/logic/types'
import { hitContour, hitToleranceMm, pickBridgeAnchor, HIT_TOL_PX } from '../hitTest'

function contourShape(id: string, pts: { x: number; y: number }[], closed = true): Shape {
  return {
    id,
    name: id,
    layer: 0,
    contours: [
      {
        id: `${id}-c`,
        points: pts,
        closed,
        area: 0,
        length: 0,
        holes: [],
        bridges: [],
        warnings: [],
      },
    ],
  }
}

/** (0,0)→(100,0) 的水平线轮廓 */
const shapes: Shape[] = [contourShape('line', [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
])]

describe('命中容差', () => {
  it('容差 = 6px / zoom', () => {
    expect(HIT_TOL_PX).toBe(6)
    expect(hitToleranceMm(2)).toBeCloseTo(3, 12)
    expect(hitToleranceMm(0.5)).toBeCloseTo(12, 12)
  })

  it('容差内命中，容差外不命中', () => {
    expect(hitContour({ x: 50, y: 2 }, shapes, 2)).not.toBeNull()
    // 2mm 外：zoom=2 时容差 3mm 命中；zoom=1 时容差 6mm 也命中；zoom=4 容差 1.5mm 不命中
    expect(hitContour({ x: 50, y: 2 }, shapes, 4)).toBeNull()
    expect(hitContour({ x: 50, y: 10 }, shapes, 1)).toBeNull()
  })

  it('少于 2 个点的轮廓不参与命中', () => {
    const one = contourShape('one', [{ x: 0, y: 0 }])
    expect(hitContour({ x: 0, y: 0 }, [one], 1)).toBeNull()
  })

  it('多个候选时取距离最近者', () => {
    const two = [
      contourShape('far', [
        { x: 0, y: 10 },
        { x: 100, y: 10 },
      ]),
      contourShape('near', [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ]
    const hit = hitContour({ x: 50, y: 0.5 }, two, 10)
    expect(hit?.shape.id).toBe('near')
  })

  it('手工连刀点返回轮廓 id 与最近段下标', () => {
    const hit = pickBridgeAnchor({ x: 25.4, y: 0.1 }, shapes, 10)
    expect(hit).toEqual({ contourId: 'line-c', atIndex: 0 })
    const hit2 = pickBridgeAnchor({ x: 75.4, y: 0.1 }, shapes, 10)
    expect(hit2?.atIndex).toBe(0) // 单段折线，最近点落在第 0 段
    expect(pickBridgeAnchor({ x: 50, y: 99 }, shapes, 1)).toBeNull()
  })
})
