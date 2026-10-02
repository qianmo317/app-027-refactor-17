import { describe, expect, it } from 'vitest'
import type { Shape } from '@/logic/types'
import {
  INITIAL_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  contentBounds,
  fitView,
  focusBounds,
  toMm,
  toPx,
  zoomAtPoint,
  zoomToAtCenter,
  type Camera,
} from '../camera'

function rectShape(id: string, x: number, y: number, w: number, h: number): Shape {
  return {
    id,
    name: id,
    layer: 0,
    contours: [
      {
        id: `${id}-c0`,
        points: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
        closed: true,
        area: w * h,
        length: 2 * (w + h),
        holes: [],
        bridges: [],
        warnings: [],
      },
    ],
  }
}

describe('camera 换算', () => {
  it('初始相机保持 2.2 倍观感', () => {
    expect(INITIAL_CAMERA).toEqual({ zoom: 2.2, panX: 0, panY: 0 })
  })

  it('toPx / toMm 互为逆运算', () => {
    const cam: Camera = { zoom: 3.5, panX: 41, panY: -17 }
    const mm = { x: 23.25, y: -8.5 }
    expect(toMm(toPx(mm, cam), cam)).toEqual(mm)
  })
})

describe('contentBounds 整图范围', () => {
  it('空内容退回 0~100', () => {
    expect(contentBounds([], null)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
  })

  it('合并所有非空轮廓', () => {
    const b = contentBounds([rectShape('a', -10, 5, 20, 30), { ...rectShape('b', 0, 0, 4, 4), contours: [] }], null)
    expect(b).toEqual({ minX: -10, minY: 5, maxX: 10, maxY: 35 })
  })

  it('纸幅并入范围', () => {
    const b = contentBounds([rectShape('a', 2, 2, 5, 5)], { widthMm: 210, heightMm: 297, name: 'A4' })
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 210, maxY: 297 })
  })
})

describe('fitView 适应窗口', () => {
  it('100×100 内容在 800×600 内按高边适配并水平居中（24px 边距）', () => {
    const cam: Camera = { ...INITIAL_CAMERA }
    fitView(cam, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, { w: 800, h: 600 })
    // 可用区 752×552，取较小比 5.52
    expect(cam.zoom).toBeCloseTo(5.52, 10)
    expect(cam.panY).toBeCloseTo(24, 10)
    // 水平留白 (752 - 100*5.52)/2 = 100，再加 pad 24
    expect(cam.panX).toBeCloseTo(124, 10)
  })

  it('带非零 minX/minY 时也居中', () => {
    const cam: Camera = { zoom: 1, panX: 0, panY: 0 }
    fitView(cam, { minX: 50, minY: 60, maxX: 60, maxY: 70 }, { w: 104, h: 104 })
    // 可用 56×56，bounds 10×10 → zoom 5.6，内容中心 (55,65) 对到视口中心 (52,52)
    expect(cam.zoom).toBeCloseTo(5.6, 10)
    expect(cam.panX).toBeCloseTo(52 - 55 * 5.6, 10)
    expect(cam.panY).toBeCloseTo(52 - 65 * 5.6, 10)
  })
})

describe('缩放范围与锚点', () => {
  it('zoom 上下限为 0.05 / 200（中心缩放）', () => {
    const cam: Camera = { zoom: 1, panX: 0, panY: 0 }
    zoomToAtCenter(cam, 1000, { w: 800, h: 600 })
    expect(cam.zoom).toBe(MAX_ZOOM)
    expect(MAX_ZOOM).toBe(200)
    zoomToAtCenter(cam, 1 / 100000, { w: 800, h: 600 })
    expect(cam.zoom).toBe(MIN_ZOOM)
    expect(MIN_ZOOM).toBe(0.05)
  })

  it('滚轮缩放后指针下的 mm 点不动', () => {
    const cam: Camera = { zoom: 2, panX: 10, panY: 20 }
    const pivot = { x: 210, y: 140 }
    const before = toMm(pivot, cam)
    zoomAtPoint(cam, 1.12, pivot)
    const after = toMm(pivot, cam)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
  })

  it('缩小滚轮因子为 1/1.12', () => {
    const cam: Camera = { zoom: 1, panX: 0, panY: 0 }
    const pivot = { x: 0, y: 0 }
    zoomAtPoint(cam, 1 / 1.12, pivot)
    expect(cam.zoom).toBeCloseTo(1 / 1.12, 12)
  })
})

describe('focusBounds 聚焦', () => {
  it('小范围放大上限 40 倍并居中', () => {
    const cam: Camera = { zoom: 1, panX: 0, panY: 0 }
    focusBounds(cam, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, { w: 800, h: 600 })
    expect(cam.zoom).toBe(40)
    // 中心 (0.5,0.5) 对到视口中心
    expect(cam.panX).toBeCloseTo(400 - 20, 10)
    expect(cam.panY).toBeCloseTo(300 - 20, 10)
  })
})
