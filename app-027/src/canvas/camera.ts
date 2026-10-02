import type { Pt, Sheet, Shape } from '@/logic/types'
import { boundsOf, mergeBounds, type Bounds } from '@/logic/geometry'

/** 画布相机状态：zoom = px/mm，pan 为 mm 原点在屏幕上的像素偏移 */
export type Camera = { zoom: number; panX: number; panY: number }

/** 初始视图（800×600 下的默认观感，挂载后会立即 fit） */
export const INITIAL_CAMERA: Camera = { zoom: 2.2, panX: 0, panY: 0 }

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 200

/** 适应窗口内边距（px） */
export const FIT_PAD_PX = 24

/** focusContour 内边距（px）与放大上限 */
export const FOCUS_PAD_PX = 70
export const FOCUS_MAX_ZOOM = 40

export type ViewSize = { w: number; h: number }

/** mm → 屏幕 px */
export function toPx(p: Pt, cam: Camera): Pt {
  return { x: p.x * cam.zoom + cam.panX, y: p.y * cam.zoom + cam.panY }
}

/** 屏幕 px → mm */
export function toMm(p: Pt, cam: Camera): Pt {
  return { x: (p.x - cam.panX) / cam.zoom, y: (p.y - cam.panY) / cam.zoom }
}

/** 整图内容范围：所有非空轮廓 + 纸幅；没有任何内容时退回 0~100 */
export function contentBounds(shapes: readonly Shape[], sheet: Sheet | null | undefined): Bounds {
  const list: Bounds[] = []
  for (const s of shapes) {
    if (s.contours.length === 0) continue
    list.push(boundsOf(s.contours.flatMap((c) => c.points)))
  }
  if (sheet) list.push({ minX: 0, minY: 0, maxX: sheet.widthMm, maxY: sheet.heightMm })
  if (list.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  return mergeBounds(list)
}

/** 适应窗口：按内容范围等比缩放到留 24px 内边距并居中，原地更新 cam */
export function fitView(cam: Camera, b: Bounds, view: ViewSize): void {
  const pad = FIT_PAD_PX
  const w = Math.max(40, view.w - pad * 2)
  const h = Math.max(40, view.h - pad * 2)
  const bw = Math.max(1, b.maxX - b.minX)
  const bh = Math.max(1, b.maxY - b.minY)
  cam.zoom = Math.min(w / bw, h / bh)
  cam.panX = pad + (w - bw * cam.zoom) / 2 - b.minX * cam.zoom
  cam.panY = pad + (h - bh * cam.zoom) / 2 - b.minY * cam.zoom
}

/** 缩放到指定倍率并保持视口中心对应的 mm 点不动，原地更新 cam */
export function zoomToAtCenter(cam: Camera, f: number, view: ViewSize): void {
  const cx = view.w / 2
  const cy = view.h / 2
  const before = { x: (cx - cam.panX) / cam.zoom, y: (cy - cam.panY) / cam.zoom }
  cam.zoom = clampZoom(cam.zoom * f)
  cam.panX = cx - before.x * cam.zoom
  cam.panY = cy - before.y * cam.zoom
}

/** 缩放并保持屏幕点 pivot（px）对应的 mm 点不动（滚轮缩放用），原地更新 cam */
export function zoomAtPoint(cam: Camera, f: number, pivot: Pt): void {
  const beforeMm = toMm(pivot, cam)
  cam.zoom = clampZoom(cam.zoom * f)
  const after = toPx(beforeMm, cam)
  cam.panX += pivot.x - after.x
  cam.panY += pivot.y - after.y
}

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

/** 聚焦到指定范围：居中并放大（上限 40 倍），原地更新 cam；成功返回 true */
export function focusBounds(cam: Camera, b: Bounds, view: ViewSize): boolean {
  const pad = FOCUS_PAD_PX
  const w = Math.max(40, view.w - pad * 2)
  const h = Math.max(40, view.h - pad * 2)
  const bw = Math.max(0.5, b.maxX - b.minX)
  const bh = Math.max(0.5, b.maxY - b.minY)
  cam.zoom = Math.min(FOCUS_MAX_ZOOM, Math.min(w / bw, h / bh))
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  cam.panX = view.w / 2 - cx * cam.zoom
  cam.panY = view.h / 2 - cy * cam.zoom
  return true
}
