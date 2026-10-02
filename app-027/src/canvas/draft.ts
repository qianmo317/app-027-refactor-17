import type { Pt } from '@/logic/types'
import { round3 } from '@/logic/geometry'

/** 矩形/圆形/多边形的草稿状态；null 表示当前没有该类草稿 */
export type DraftState = {
  rect: { x: number; y: number; w: number; h: number } | null
  circle: { cx: number; cy: number; r: number } | null
  polygon: Pt[]
}

export function emptyDraft(): DraftState {
  return { rect: null, circle: null, polygon: [] }
}

/** 清空全部草稿（切换工具 / Esc） */
export function cancelDraft(): DraftState {
  return emptyDraft()
}

// ---------------- 矩形 ----------------
// 草稿矩形是「锚点角 + 当前角」的归一化形态：
// (x,y) 始终为已到达过的远端角，另一个角为当前指针点。
// 拖回原侧时锚点会让位给当前点，因此每轴独立取 min/历史最大。

/** 按下：以 mm 点为初始角开始矩形草稿 */
export function beginRect(draft: DraftState, mm: Pt): DraftState {
  return { ...draft, rect: { x: mm.x, y: mm.y, w: 0, h: 0 } }
}

/** 拖动：按当前指针更新矩形（原草稿的 x+w/y+h 角为起始锚点） */
export function updateRect(draft: DraftState, mm: Pt): DraftState {
  const s = draft.rect
  if (!s) return draft
  return {
    ...draft,
    rect: {
      x: Math.min(s.x + s.w, mm.x),
      y: Math.min(s.y + s.h, mm.y),
      w: Math.abs(mm.x - (s.x + s.w)),
      h: Math.abs(mm.y - (s.y + s.h)),
    },
  }
}

/** 抬起：清掉草稿；宽高均 > 0.5mm 时返回应提交的矩形（保留 3 位小数） */
export function finishRect(
  draft: DraftState,
): { next: DraftState; commit: { x: number; y: number; w: number; h: number } | null } {
  const r = draft.rect
  const next = { ...draft, rect: null }
  if (r && r.w > 0.5 && r.h > 0.5) {
    return { next, commit: { x: round3(r.x), y: round3(r.y), w: round3(r.w), h: round3(r.h) } }
  }
  return { next, commit: null }
}

// ---------------- 圆形 ----------------

/** 按下：以 mm 点为圆心开始圆形草稿 */
export function beginCircle(draft: DraftState, mm: Pt): DraftState {
  return { ...draft, circle: { cx: mm.x, cy: mm.y, r: 0 } }
}

/** 拖动：圆心不动，半径取到指针的距离 */
export function updateCircle(draft: DraftState, mm: Pt): DraftState {
  const c = draft.circle
  if (!c) return draft
  return { ...draft, circle: { cx: c.cx, cy: c.cy, r: Math.hypot(mm.x - c.cx, mm.y - c.cy) } }
}

/** 抬起：清掉草稿；半径 > 0.5mm 时返回应提交的圆（保留 3 位小数） */
export function finishCircle(
  draft: DraftState,
): { next: DraftState; commit: { cx: number; cy: number; r: number } | null } {
  const c = draft.circle
  const next = { ...draft, circle: null }
  if (c && c.r > 0.5) return { next, commit: { cx: round3(c.cx), cy: round3(c.cy), r: round3(c.r) } }
  return { next, commit: null }
}

// ---------------- 多边形 ----------------

/** 落点：追加一个顶点（保留 3 位小数） */
export function addPolygonPoint(draft: DraftState, mm: Pt): DraftState {
  return { ...draft, polygon: [...draft.polygon, { x: round3(mm.x), y: round3(mm.y) }] }
}

/** 完成：顶点 ≥ 3 时返回应提交的点列副本，随后清空 */
export function finishPolygon(draft: DraftState): { next: DraftState; commit: Pt[] | null } {
  const points = draft.polygon
  return { next: { ...draft, polygon: [] }, commit: points.length >= 3 ? points.slice() : null }
}
