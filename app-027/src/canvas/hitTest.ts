import type { Pt, Shape } from '@/logic/types'
import { closestOnPolyline } from '@/logic/geometry'

/** 点选容差（屏幕 px），换算成 mm 时除以缩放 */
export const HIT_TOLERANCE_PX = 6

/** 命中容差（mm）：固定 6 个屏幕像素 */
export function hitToleranceMm(zoom: number): number {
  return HIT_TOLERANCE_PX / zoom
}

export type ContourHit = {
  shape: Shape
  contour: Shape['contours'][number]
  distance: number
}

/** 在容差内找离 mm 点最近的轮廓 */
export function hitTestContours(shapes: Shape[], mm: Pt, tolMm: number): ContourHit | null {
  let best: ContourHit | null = null
  for (const s of shapes) {
    for (const c of s.contours) {
      if (c.points.length < 2) continue
      const d = closestOnPolyline(mm, c.points, c.closed).distance
      if (d <= tolMm && (!best || d < best.distance)) best = { shape: s, contour: c, distance: d }
    }
  }
  return best
}

/** 手工连刀：命中轮廓后取最近投影点的顶点下标 */
export function manualBridgeAt(shapes: Shape[], mm: Pt, tolMm: number): { contourId: string; atIndex: number } | null {
  const hit = hitTestContours(shapes, mm, tolMm)
  if (!hit) return null
  const c = closestOnPolyline(mm, hit.contour.points, hit.contour.closed)
  return { contourId: hit.contour.id, atIndex: c.index }
}
