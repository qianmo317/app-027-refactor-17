import type { Pt, Shape, Sheet } from '@/logic/types'
import { boundsOf, mergeBounds, type Bounds } from '@/logic/geometry'

/** 画布可视区尺寸（屏幕 px） */
export type ViewSize = { w: number; h: number }

/** 视图变换：mm 坐标 → 屏幕 px 的缩放与平移 */
export type ViewTransform = {
  zoom: number
  panX: number
  panY: number
}

/** 缩放范围 */
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 200

/** 整图适配留白（px） */
export const FIT_PAD = 24
/** 聚焦单条轮廓的留白（px）与缩放上限 */
export const FOCUS_PAD = 70
export const FOCUS_MAX_ZOOM = 40

/** 滚轮缩放步进 */
export const WHEEL_ZOOM_FACTOR = 1.12

/** mm → 屏幕 px */
export function toPx(p: Pt, v: ViewTransform): Pt {
  return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY }
}

/** 屏幕 px → mm */
export function toMm(p: Pt, v: ViewTransform): Pt {
  return { x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom }
}

export function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
}

/** 内容包围盒：全部图形轮廓 + 纸幅；空内容退化为 100×100 */
export function contentBounds(shapes: Shape[], sheet: Sheet | null | undefined): Bounds {
  const list: Bounds[] = []
  for (const s of shapes) {
    if (s.contours.length === 0) continue
    list.push(boundsOf(s.contours.flatMap((c) => c.points)))
  }
  if (sheet) list.push({ minX: 0, minY: 0, maxX: sheet.widthMm, maxY: sheet.heightMm })
  if (list.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  return mergeBounds(list)
}

/** 适配缩放：留白 pad、可视边长下限 40px、内容跨度下限 minSpan、缩放上限 maxZoom */
function fitZoom(
  b: Bounds,
  size: ViewSize,
  pad: number,
  minSpan: number,
  maxZoom: number,
): { zoom: number; w: number; h: number; bw: number; bh: number } {
  const w = Math.max(40, size.w - pad * 2)
  const h = Math.max(40, size.h - pad * 2)
  const bw = Math.max(minSpan, b.maxX - b.minX)
  const bh = Math.max(minSpan, b.maxY - b.minY)
  return { zoom: Math.min(maxZoom, Math.min(w / bw, h / bh)), w, h, bw, bh }
}

/** 整图适配：内容居中于可视区 */
export function fitView(b: Bounds, size: ViewSize): ViewTransform {
  const { zoom, w, h, bw, bh } = fitZoom(b, size, FIT_PAD, 1, Infinity)
  return {
    zoom,
    panX: FIT_PAD + (w - bw * zoom) / 2 - b.minX * zoom,
    panY: FIT_PAD + (h - bh * zoom) / 2 - b.minY * zoom,
  }
}

/** 聚焦单条轮廓：居中并放大（封顶 FOCUS_MAX_ZOOM） */
export function focusView(b: Bounds, size: ViewSize): ViewTransform {
  const { zoom } = fitZoom(b, size, FOCUS_PAD, 0.5, FOCUS_MAX_ZOOM)
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  return {
    zoom,
    panX: size.w / 2 - cx * zoom,
    panY: size.h / 2 - cy * zoom,
  }
}

/** 以画布中心为锚点按比例缩放 */
export function zoomBy(v: ViewTransform, size: ViewSize, f: number): ViewTransform {
  const cx = size.w / 2
  const cy = size.h / 2
  const before = toMm({ x: cx, y: cy }, v)
  const zoom = clampZoom(v.zoom * f)
  return { zoom, panX: cx - before.x * zoom, panY: cy - before.y * zoom }
}

/** 以屏幕上某点为锚点缩放（滚轮：先按中心缩放，再平移使光标下的点保持不动） */
export function zoomAt(v: ViewTransform, size: ViewSize, px: Pt, f: number): ViewTransform {
  const before = toMm(px, v)
  const z = zoomBy(v, size, f)
  const after = toPx(before, z)
  return { ...z, panX: z.panX + px.x - after.x, panY: z.panY + px.y - after.y }
}

/** 开始拖动平移：记录光标位置与当前平移的差值 */
export function beginPan(v: ViewTransform, px: Pt): Pt {
  return { x: px.x - v.panX, y: px.y - v.panY }
}

/** 拖动平移：由起点差值与当前光标位置求新平移 */
export function panTo(start: Pt, px: Pt): { panX: number; panY: number } {
  return { panX: px.x - start.x, panY: px.y - start.y }
}

/** 网格线与刻度标签（mm 坐标系） */
export function gridLines(b: Bounds): { v: number[]; h: number[]; label: Array<{ x: number; y: number; t: string }> } {
  let step = 10
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY)
  if (span / step > 40) step = 50
  if (span / step < 6) step = 5
  const v: number[] = []
  const h: number[] = []
  const label: Array<{ x: number; y: number; t: string }> = []
  const x0 = Math.floor(b.minX / step) * step
  const y0 = Math.floor(b.minY / step) * step
  for (let x = x0; x <= b.maxX + step; x += step) {
    v.push(x)
    label.push({ x, y: b.minY, t: String(Math.round(x)) })
  }
  for (let y = y0; y <= b.maxY + step; y += step) {
    h.push(y)
    label.push({ x: b.minX, y, t: String(Math.round(y)) })
  }
  return { v, h, label }
}

/** 缺口放大镜：倍率与数量上限 */
export const MAGNIFIER_ZOOM = 8
export const MAGNIFIER_LIMIT = 8

export type MagnifierInput = {
  /** 缺口锚点（mm，已含纸幅摆放变换） */
  at: Pt
  end: Pt
  local: Pt[]
  widthMm: number
  contourId: string
}

export type MagnifierLayout = {
  key: string
  anchor: Pt
  center: Pt
  local: Pt[]
  gapA: Pt
  gapB: Pt
  widthMm: number
  clipId: string
}

/** 放大镜布局：沿画布底部每排 4 个排布，局部几何相对锚点放大 MAGNIFIER_ZOOM 倍 */
export function magnifierLayout(items: MagnifierInput[], toScreen: (p: Pt) => Pt, size: ViewSize): MagnifierLayout[] {
  return items.slice(0, MAGNIFIER_LIMIT).map((b, i) => {
    const anchor = toScreen(b.at)
    const center = { x: 62 + (i % 4) * 128, y: size.h - 74 - Math.floor(i / 4) * 128 }
    const local = b.local.map((p) => {
      const s = toScreen(p)
      return { x: center.x + (s.x - anchor.x) * MAGNIFIER_ZOOM, y: center.y + (s.y - anchor.y) * MAGNIFIER_ZOOM }
    })
    const endPx = toScreen(b.end)
    const gapA = { x: center.x, y: center.y }
    const gapB = {
      x: center.x + (endPx.x - anchor.x) * MAGNIFIER_ZOOM,
      y: center.y + (endPx.y - anchor.y) * MAGNIFIER_ZOOM,
    }
    return { key: `${b.contourId}-${i}`, anchor, center, local, gapA, gapB, widthMm: b.widthMm, clipId: `magclip-${i}` }
  })
}
