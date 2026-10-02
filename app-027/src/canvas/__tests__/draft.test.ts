import { describe, expect, it } from 'vitest'
import {
  addPolygonPoint,
  beginCircle,
  beginRect,
  cancelDraft,
  emptyDraft,
  finishCircle,
  finishPolygon,
  finishRect,
  updateCircle,
  updateRect,
} from '../draft'

describe('矩形草稿（锚点角 + 当前角）', () => {
  it('向右下拖拽', () => {
    let d = beginRect(emptyDraft(), { x: 10, y: 20 })
    d = updateRect(d, { x: 30, y: 50 })
    expect(d.rect).toEqual({ x: 10, y: 20, w: 20, h: 30 })
  })

  it('向左上拖拽时起始角让位给当前点（原画布逐 move 归一化行为）', () => {
    let d = beginRect(emptyDraft(), { x: 30, y: 50 })
    d = updateRect(d, { x: 10, y: 20 })
    expect(d.rect).toEqual({ x: 10, y: 20, w: 20, h: 30 })
  })

  it('越过起始侧再拖回：锚点角取「上一轮远端角」与当前点的 min（与原画布逐 move 归一化一致）', () => {
    let d = beginRect(emptyDraft(), { x: 30, y: 30 })
    d = updateRect(d, { x: 10, y: 10 })
    expect(d.rect).toEqual({ x: 10, y: 10, w: 20, h: 20 })
    d = updateRect(d, { x: 40, y: 5 })
    // 第二轮以「上一轮远端角」(x+w, y+h) = (30,30) 为基准做 min/abs：
    // x: min(30,40)=30, |40-30|=10；y: min(30,5)=5, |5-30|=25
    expect(d.rect).toEqual({ x: 30, y: 5, w: 10, h: 25 })
  })

  it('宽高均 > 0.5mm 才提交，并四舍五入到 3 位', () => {
    let d = beginRect(emptyDraft(), { x: 1, y: 1 })
    d = updateRect(d, { x: 2, y: 1.4 })
    let r = finishRect(d)
    expect(r.commit).toBeNull()
    expect(r.next.rect).toBeNull()

    d = beginRect(emptyDraft(), { x: 1.0004, y: 1.0004 })
    d = updateRect(d, { x: 2.0004, y: 3.0004 })
    r = finishRect(d)
    expect(r.commit).toEqual({ x: 1, y: 1, w: 1, h: 2 })
  })

  it('不满足提交条件时草稿也被清空', () => {
    let d = updateRect(beginRect(emptyDraft(), { x: 0, y: 0 }), { x: 0.2, y: 0.2 })
    d = finishRect(d).next
    expect(d.rect).toBeNull()
  })
})

describe('圆形草稿', () => {
  it('圆心不动半径跟随指针', () => {
    let d = beginCircle(emptyDraft(), { x: 10, y: 0 })
    d = updateCircle(d, { x: 13, y: 4 })
    expect(d.circle).toEqual({ cx: 10, cy: 0, r: 5 })
  })

  it('半径 > 0.5mm 才提交（3 位小数）', () => {
    const small = finishCircle(updateCircle(beginCircle(emptyDraft(), { x: 0, y: 0 }), { x: 0.4, y: 0 }))
    expect(small.commit).toBeNull()
    const ok = finishCircle(updateCircle(beginCircle(emptyDraft(), { x: 0, y: 0 }), { x: 3, y: 4 }))
    expect(ok.commit).toEqual({ cx: 0, cy: 0, r: 5 })
  })
})

describe('多边形草稿', () => {
  it('逐点追加（3 位小数）', () => {
    let d = emptyDraft()
    d = addPolygonPoint(d, { x: 1.0004, y: 2.0006 })
    d = addPolygonPoint(d, { x: 3, y: 4 })
    expect(d.polygon).toEqual([
      { x: 1, y: 2.001 },
      { x: 3, y: 4 },
    ])
  })

  it('满 3 点完成时提交点列副本并清空；不足 3 点不提交', () => {
    let d = addPolygonPoint(emptyDraft(), { x: 0, y: 0 })
    d = addPolygonPoint(d, { x: 1, y: 0 })
    expect(finishPolygon(d).commit).toBeNull()
    d = addPolygonPoint(d, { x: 1, y: 1 })
    const r = finishPolygon(d)
    expect(r.commit).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ])
    expect(r.next.polygon).toEqual([])
  })

  it('cancelDraft 清空全部草稿', () => {
    let d = beginRect(beginCircle(emptyDraft(), { x: 0, y: 0 }), { x: 0, y: 0 })
    d = addPolygonPoint(d, { x: 1, y: 1 })
    d = cancelDraft()
    expect(d).toEqual(emptyDraft())
  })
})
