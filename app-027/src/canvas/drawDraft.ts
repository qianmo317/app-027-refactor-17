import type { Pt } from '@/logic/types'
import { round3 } from '@/logic/geometry'

/** 矩形 / 圆形草稿生效的最小尺寸（mm） */
export const DRAFT_MIN_MM = 0.5

export type RectDraft = { x: number; y: number; w: number; h: number }
export type CircleDraft = { cx: number; cy: number; r: number }

export function startRect(at: Pt): RectDraft {
  return { x: at.x, y: at.y, w: 0, h: 0 }
}

/** 拖动更新矩形：以上一次的右/下边为锚重新归一化 */
export function updateRect(d: RectDraft, at: Pt): RectDraft {
  return {
    x: Math.min(d.x + d.w, at.x),
    y: Math.min(d.y + d.h, at.y),
    w: Math.abs(at.x - (d.x + d.w)),
    h: Math.abs(at.y - (d.y + d.h)),
  }
}

/** 结束矩形：宽高都超过 DRAFT_MIN_MM 才产出（坐标保留 3 位小数） */
export function finishRect(d: RectDraft): RectDraft | null {
  if (d.w <= DRAFT_MIN_MM || d.h <= DRAFT_MIN_MM) return null
  return { x: round3(d.x), y: round3(d.y), w: round3(d.w), h: round3(d.h) }
}

export function startCircle(at: Pt): CircleDraft {
  return { cx: at.x, cy: at.y, r: 0 }
}

export function updateCircle(d: CircleDraft, at: Pt): CircleDraft {
  return { cx: d.cx, cy: d.cy, r: Math.hypot(at.x - d.cx, at.y - d.cy) }
}

/** 结束圆形：半径超过 DRAFT_MIN_MM 才产出（坐标保留 3 位小数） */
export function finishCircle(d: CircleDraft): CircleDraft | null {
  if (d.r <= DRAFT_MIN_MM) return null
  return { cx: round3(d.cx), cy: round3(d.cy), r: round3(d.r) }
}

/** 多边形草稿：追加一个顶点（坐标保留 3 位小数） */
export function addPolygonPoint(draft: Pt[], at: Pt): Pt[] {
  return [...draft, { x: round3(at.x), y: round3(at.y) }]
}

/** 多边形草稿：≥ 3 个顶点才可完成 */
export function canFinishPolygon(draft: Pt[]): boolean {
  return draft.length >= 3
}

/** 完成多边形：顶点不足时返回 null */
export function finishPolygon(draft: Pt[]): Pt[] | null {
  return draft.length >= 3 ? draft.slice() : null
}
