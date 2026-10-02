import { describe, expect, it } from 'vitest'
import type { Pt, Shape } from '@/logic/types'
import type { ComputedShape } from '@/logic/pipeline'
import type { CutStep } from '@/logic/order'
import type { Job } from '@/logic/job'
import type { BridgeAnchor } from '@/logic/bridges'
import {
  MAGNIFIER_ZOOM,
  buildBridges,
  buildCutPaths,
  buildGridLines,
  buildMagnifiers,
  buildNumbers,
  buildOutlineContours,
  buildSimulation,
  buildTravels,
  collectCutSteps,
  makeProjector,
  pointsToD,
} from '../render'
import type { Camera } from '../camera'

function contour(id: string, pts: Pt[], warnings: Shape['contours'][number]['warnings'] = [], closed = true): Shape['contours'][number] {
  return { id, points: pts, closed, area: 0, length: 0, holes: [], bridges: [], warnings }
}

function shape(id: string, contours: Shape['contours'][number]): Shape {
  return { id, name: id, layer: 0, contours: [contours] }
}

const cam: Camera = { zoom: 2, panX: 10, panY: 20 }

describe('pointsToD', () => {
  it('坐标保留 3 位，闭合追加 Z', () => {
    expect(pointsToD([{ x: 1, y: 2 }, { x: 3, y: 4 }], true)).toBe('M1.000 2.000L3.000 4.000Z')
    expect(pointsToD([{ x: 1, y: 2 }], false)).toBe('M1.000 2.000')
    expect(pointsToD([], true)).toBe('')
  })
})

describe('成品轮廓（三种显示模式的颜色）', () => {
  const shapes: Shape[] = [
    shape('plain', contour('c-plain', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])),
    shape('open', contour('c-open', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ], ['not_closed'], false)),
    shape('dup', contour('c-dup', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ], ['duplicate'])),
  ]

  it('outline 模式：普通 #cfd9e4，未闭合黄 + 7 4 虚线，重复紫 + 5 4 虚线', () => {
    const out = buildOutlineContours(shapes, 'outline', null)
    expect(out[0].color).toBe('#cfd9e4')
    expect(out[0].dash).toBe('')
    expect(out[1].color).toBe('#ffc857')
    expect(out[1].dash).toBe('7 4')
    expect(out[2].color).toBe('#b48cff')
    expect(out[2].dash).toBe('5 4')
  })

  it('bridge 模式：普通轮廓变灰 #4a5768，警告色不变', () => {
    const out = buildOutlineContours(shapes, 'bridge', null)
    expect(out[0].color).toBe('#4a5768')
    expect(out[1].color).toBe('#ffc857')
  })

  it('选中轮廓线宽 2.4，其余 1.2', () => {
    const out = buildOutlineContours(shapes, 'outline', 'c-plain')
    expect(out[0].width).toBe(2.4)
    expect(out[1].width).toBe(1.2)
  })

  it('自交为红色实线', () => {
    const out = buildOutlineContours([shape('si', contour('c-si', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ], ['self_intersect']))], 'outline', null)
    expect(out[0].color).toBe('#ff6b6b')
    expect(out[0].dash).toBe('')
  })
})

function step(i: number, contourId: string, a: Pt, b: Pt): CutStep {
  return {
    seq: i + 1,
    contourId,
    runIndex: 0,
    runCount: 1,
    points: [a, b],
    closed: false,
    startPt: a,
    endPt: b,
    travelFromPrevMm: 0,
    level: 1,
    layer: 0,
    lengthMm: 1,
  }
}

describe('刀路 / 跳刀 / 编号', () => {
  const steps: CutStep[] = [
    step(0, 'c1', { x: 0, y: 0 }, { x: 1, y: 0 }),
    step(1, 'c2', { x: 5, y: 5 }, { x: 6, y: 5 }),
  ]
  const pl = makeProjector(null)

  it('有 job 用 job.steps，否则拼派生结果', () => {
    const derived = new Map<string, ComputedShape>()
    const fakeComp = { order: { steps: [steps[0]] } } as ComputedShape
    derived.set('s1', fakeComp)
    expect(collectCutSteps([shape('s1', contour('x', []))], derived, null)).toHaveLength(1)
    const job = { steps } as Job
    expect(collectCutSteps([], new Map(), job)).toBe(steps)
  })

  it('cutPaths：选中变绿', () => {
    const paths = buildCutPaths(steps, pl, 'c2')
    expect(paths[1].selected).toBe(true)
    expect(paths[0].selected).toBe(false)
  })

  it('travels：相邻段首尾相连', () => {
    expect(buildTravels(steps, pl)).toEqual([{ x1: 1, y1: 0, x2: 5, y2: 5 }])
    expect(buildTravels([steps[0]], pl)).toEqual([])
  })

  it('编号从 1 开始且上限 120', () => {
    const many = Array.from({ length: 130 }, (_, i) => step(i, 'c', { x: i, y: 0 }, { x: i + 1, y: 0 }))
    const nums = buildNumbers(true, many, pl)
    expect(nums).toHaveLength(120)
    expect(nums[0].i).toBe(1)
    expect(nums[119].more).toBe(true)
    expect(buildNumbers(false, many, pl)).toEqual([])
  })

  it('placement 通过 projector 平移坐标', () => {
    const placed = makeProjector({ marginMm: 10, offsetX: 3, offsetY: 7, scale: 1, outOfSheet: false, placedBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } })
    expect(placed({ x: 1, y: 2 })).toEqual({ x: 4, y: 9 })
  })
})

describe('连刀点缺口与放大镜', () => {
  function computedWithAnchors(shapeId: string, contourId: string, anchors: BridgeAnchor[]) {
    return new Map<string, ComputedShape>([
      [shapeId, { byId: new Map([[contourId, { anchors }]]) } as unknown as ComputedShape],
    ])
  }

  const anchor: BridgeAnchor = { at: { x: 10, y: 10 }, end: { x: 11, y: 10 }, widthMm: 0.5, atIndex: 3, local: [{ x: 9, y: 10 }, { x: 12, y: 10 }] }
  const shapes = [shape('s', contour('c', [
    { x: 9, y: 10 },
    { x: 12, y: 10 },
  ]))]
  const computed = computedWithAnchors('s', 'c', [anchor])

  it('buildBridges 摊平安锚点', () => {
    const b = buildBridges(shapes, computed)
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ x: 10, y: 10, widthMm: 0.5, contourId: 'c' })
  })

  it('仅 bridge 模式且 magnify=true 时生成，最多 8 个', () => {
    const manyComputed = computedWithAnchors(
      's',
      'c',
      Array.from({ length: 10 }, (_, i): BridgeAnchor => ({ ...anchor, at: { x: 10 + i, y: 10 } })),
    )
    const many = buildBridges(shapes, manyComputed)
    const view = { w: 800, h: 600 }
    expect(buildMagnifiers(true, 'outline', many, makeProjector(null), cam, view)).toEqual([])
    expect(buildMagnifiers(false, 'bridge', many, makeProjector(null), cam, view)).toEqual([])
    const ms = buildMagnifiers(true, 'bridge', many, makeProjector(null), cam, view)
    expect(ms).toHaveLength(8)
  })

  it('位置在右下两行四列，局部几何 ×8，连线指向屏幕锚点', () => {
    const ms = buildMagnifiers(true, 'bridge', buildBridges(shapes, computed), makeProjector(null), cam, { w: 800, h: 600 })
    const m = ms[0]
    // 第 0 个中心 (62, 600-74=526)
    expect(m.center).toEqual({ x: 62, y: 526 })
    // 屏幕锚点 = (10*2+10, 10*2+20) = (30,40)
    expect(m.anchor).toEqual({ x: 30, y: 40 })
    // 局部点 (9,10) 屏幕 = (28,40)，相对锚点 (-2,0)，×8 → center + (-16,0)
    expect(m.local[0]).toEqual({ x: 62 - 16, y: 526 })
    // gapB：end (11,10) 屏幕 (32,40)，偏移 (2,0) × 8
    expect(m.gapA).toEqual({ x: 62, y: 526 })
    expect(m.gapB).toEqual({ x: 62 + 16, y: 526 })
    expect(MAGNIFIER_ZOOM).toBe(8)
    expect(m.clipId).toBe('magclip-0')
  })

  it('第 5 个换到第二行第一列（i=4：列 0、行 1），y 抬高 128', () => {
    const fiveComputed = computedWithAnchors('s', 'c', Array.from({ length: 5 }, (): BridgeAnchor => anchor))
    const ms = buildMagnifiers(true, 'bridge', buildBridges(shapes, fiveComputed), makeProjector(null), cam, { w: 800, h: 600 })
    expect(ms[4].center).toEqual({ x: 62, y: 526 - 128 })
  })
})

describe('网格步距', () => {
  it('默认 10mm；跨度 > 400 用 50；跨度 < 60 用 5', () => {
    expect(buildGridLines(true, { minX: 0, minY: 0, maxX: 100, maxY: 100 }).v[1] - buildGridLines(true, { minX: 0, minY: 0, maxX: 100, maxY: 100 }).v[0]).toBe(10)
    const big = buildGridLines(true, { minX: 0, minY: 0, maxX: 500, maxY: 500 })
    expect(big.v[1] - big.v[0]).toBe(50)
    const small = buildGridLines(true, { minX: 0, minY: 0, maxX: 50, maxY: 50 })
    expect(small.v[1] - small.v[0]).toBe(5)
  })

  it('关闭时为空', () => {
    expect(buildGridLines(false, { minX: 0, minY: 0, maxX: 100, maxY: 100 })).toEqual({ v: [], h: [], label: [] })
  })

  it('起点对齐到步距整数倍（floor）并覆盖到边界之外一格', () => {
    const g = buildGridLines(true, { minX: -23, minY: -23, maxX: 23, maxY: 23 })
    expect(g.v[0]).toBe(-25)
    expect(g.v[g.v.length - 1]).toBeGreaterThanOrEqual(23)
  })
})

describe('仿真轨迹', () => {
  const pl = makeProjector(null)

  it('空路径为空视图', () => {
    expect(buildSimulation(null, -1, pl, cam)).toEqual({ pts: [], head: null, donePath: '' })
    expect(buildSimulation([], 0, pl, cam)).toEqual({ pts: [], head: null, donePath: '' })
  })

  it('点经过相机换算；simIndex 越界夹到末点', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]
    const v = buildSimulation(path, 99, pl, cam)
    expect(v.pts).toEqual([
      { x: 10, y: 20 },
      { x: 12, y: 22 },
      { x: 14, y: 24 },
    ])
    expect(v.head).toEqual({ x: 14, y: 24 })
  })

  it('donePath 至少包含第一个点，坐标保留 1 位', () => {
    const v = buildSimulation([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ], 1, pl, cam)
    expect(v.donePath).toBe('M10.0 20.0')
    const v0 = buildSimulation([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ], -1, pl, cam)
    expect(v0.donePath).toBe('')
  })
})
