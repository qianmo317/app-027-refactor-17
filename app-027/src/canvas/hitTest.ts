import type { Pt, Shape } from '@/logic/types'
import { closestOnPolyline } from '@/logic/geometry'

/** 屏幕像素命中容差（在当前 zoom 下折算为 mm） */
export const HIT_TOL_PX = 6

export type ContourHit = { shape: Shape; contour: Shape['contours'][number] }

/** mm 容差 = 6px / zoom */
export function hitToleranceMm(zoom: number): number {
  return HIT_TOL_PX / zoom
}

/**
 * 点选命中：在容差内返回距离最近的轮廓。
 * 同距时以遍历顺序（形状顺序 → 轮廓顺序）为先，与画布原行为一致。
 */
export function hitContour(mm: Pt, shapes: readonly Shape[], zoom: number): ContourHit | null {
  const tol = hitToleranceMm(zoom)
  let best: (ContourHit & { d: number }) | null = null
  for (const s of shapes) {
    for (const c of s.contours) {
      if (c.points.length < 2) continue
      const d = closestOnPolyline(mm, c.points, c.closed).distance
      if (d <= tol && (!best || d < best.d)) best = { shape: s, contour: c, d }
    }
  }
  return best ? { shape: best.shape, contour: best.contour } : null
}

/** 手工连刀点：返回命中轮廓及其折线上最近点的段下标 */
export function pickBridgeAnchor(
  mm: Pt,
  shapes: readonly Shape[],
  zoom: number,
): { contourId: string; atIndex: number } | null {
  const hit = hitContour(mm, shapes, zoom)
  if (!hit) return null
  const c = closestOnPolyline(mm, hit.contour.points, hit.contour.closed)
  return { contourId: hit.contour.id, atIndex: c.index }
}
