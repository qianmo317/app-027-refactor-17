import type { Pt, Shape } from '@/logic/types'
import type { ComputedShape } from '@/logic/pipeline'
import type { Job } from '@/logic/job'
import type { CutStep } from '@/logic/order'
import { boundsOf, type Bounds } from '@/logic/geometry'
import { placePoint, type SheetPlacement } from '@/logic/exporters'
import type { Camera, ViewSize } from './camera'
import { toPx } from './camera'

export type Mode = 'outline' | 'toolpath' | 'bridge'

// ---------------- 基础路径 ----------------

export function pointsToD(pts: Pt[], closed: boolean): string {
  if (pts.length === 0) return ''
  let d = `M${pts[0].x.toFixed(3)} ${pts[0].y.toFixed(3)}`
  for (let i = 1; i < pts.length; i++) d += `L${pts[i].x.toFixed(3)} ${pts[i].y.toFixed(3)}`
  if (closed) d += 'Z'
  return d
}

// ---------------- 成品轮廓 ----------------

export type DrawContour = {
  id: string
  shapeId: string
  d: string
  contour: Shape['contours'][number]
  color: string
  dash: string
  width: number
}

export const WARNING_COLOR: Record<string, string> = {
  not_closed: '#ffc857',
  self_intersect: '#ff6b6b',
  duplicate: '#b48cff',
  offset_failed: '#ff6b6b',
  offset_clipped: '#5aa9ff',
  bridge_degraded: '#ff8f3c',
}

export function buildOutlineContours(shapes: readonly Shape[], mode: Mode, selectedContourId: string | null): DrawContour[] {
  const out: DrawContour[] = []
  for (const s of shapes) {
    for (const c of s.contours) {
      const bad = c.warnings.find((w) => w === 'self_intersect' || w === 'not_closed' || w === 'duplicate')
      out.push({
        id: c.id,
        shapeId: s.id,
        d: pointsToD(c.points, c.closed),
        contour: c,
        color: bad ? WARNING_COLOR[bad] : mode === 'bridge' ? '#4a5768' : '#cfd9e4',
        dash: bad === 'duplicate' ? '5 4' : bad === 'not_closed' ? '7 4' : '',
        width: c.id === selectedContourId ? 2.4 : 1.2,
      })
    }
  }
  return out
}

// ---------------- 刀路 / 跳刀 / 编号 ----------------

/** 刀路段：有 job 用 job，否则按形状顺序拼接派生结果 */
export function collectCutSteps(shapes: readonly Shape[], computed: ReadonlyMap<string, ComputedShape>, job: Job | null | undefined): CutStep[] {
  if (job) return job.steps
  const out: CutStep[] = []
  for (const s of shapes) {
    const c = computed.get(s.id)
    if (!c) continue
    for (const st of c.order.steps) out.push(st)
  }
  return out
}

export type Projector = (p: Pt) => Pt

export function makeProjector(placement: SheetPlacement | null | undefined): Projector {
  return placement ? (p) => placePoint(p, placement) : (p) => p
}

export function buildCutPaths(steps: readonly CutStep[], pl: Projector, selectedContourId: string | null) {
  return steps.map((st, i) => ({
    i,
    d: pointsToD(st.points.map(pl), st.closed),
    selected: st.contourId === selectedContourId,
  }))
}

export function buildTravels(steps: readonly CutStep[], pl: Projector): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (let i = 1; i < steps.length; i++) {
    const a = pl(steps[i - 1].endPt)
    const b = pl(steps[i].startPt)
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  return out
}

const NUMBER_LIMIT = 120

export function buildNumbers(show: boolean, steps: readonly CutStep[], pl: Projector) {
  if (!show) return []
  return steps.slice(0, NUMBER_LIMIT).map((st, i) => {
    const p = pl(st.startPt)
    return { i: i + 1, x: p.x, y: p.y, more: steps.length > NUMBER_LIMIT && i === NUMBER_LIMIT - 1 }
  })
}

// ---------------- 连刀点缺口 ----------------

export type BridgeMark = { x: number; y: number; end: Pt; widthMm: number; local: Pt[]; contourId: string }

/** 连刀点缺口（来自派生结果，用于放大视图） */
export function buildBridges(shapes: readonly Shape[], computed: ReadonlyMap<string, ComputedShape>): BridgeMark[] {
  const out: BridgeMark[] = []
  for (const s of shapes) {
    const comp = computed.get(s.id)
    if (!comp) continue
    for (const c of s.contours) {
      const entry = comp.byId.get(c.id)
      if (!entry) continue
      for (const a of entry.anchors) {
        out.push({
          x: a.at.x,
          y: a.at.y,
          end: a.end,
          widthMm: a.widthMm,
          local: a.local,
          contourId: c.id,
        })
      }
    }
  }
  return out
}

// ---------------- 缺口放大镜 ----------------

export const MAGNIFIER_ZOOM = 8
const MAGNIFIER_LIMIT = 8

export type Magnifier = {
  key: string
  anchor: Pt
  center: Pt
  local: Pt[]
  gapA: Pt
  gapB: Pt
  widthMm: number
  clipId: string
}

/** 每个缺口对应的放大镜（屏幕坐标 + 局部几何屏幕坐标）；仅 bridge 模式且开启时生成 */
export function buildMagnifiers(
  enabled: boolean,
  mode: Mode,
  bridges: readonly BridgeMark[],
  pl: Projector,
  cam: Camera,
  view: ViewSize,
): Magnifier[] {
  if (!enabled || mode !== 'bridge') return []
  return bridges.slice(0, MAGNIFIER_LIMIT).map((b, i) => {
    const anchor = toPx(pl({ x: b.x, y: b.y }), cam)
    const center = { x: 62 + (i % 4) * 128, y: view.h - 74 - Math.floor(i / 4) * 128 }
    const local = b.local.map((p) => {
      const s = toPx(pl(p), cam)
      return { x: center.x + (s.x - anchor.x) * MAGNIFIER_ZOOM, y: center.y + (s.y - anchor.y) * MAGNIFIER_ZOOM }
    })
    const endPx = toPx(pl(b.end), cam)
    const gapA = { x: center.x, y: center.y }
    const gapB = { x: center.x + (endPx.x - anchor.x) * MAGNIFIER_ZOOM, y: center.y + (endPx.y - anchor.y) * MAGNIFIER_ZOOM }
    return { key: `${b.contourId}-${i}`, anchor, center, local, gapA, gapB, widthMm: b.widthMm, clipId: `magclip-${i}` }
  })
}

// ---------------- 仿真轨迹 ----------------

export type SimulationView = { pts: Pt[]; head: Pt | null; donePath: string }

export function buildSimulation(
  simPath: Pt[] | null | undefined,
  simIndex: number,
  pl: Projector,
  cam: Camera,
): SimulationView {
  if (!simPath || simPath.length === 0) return { pts: [], head: null, donePath: '' }
  const pts = simPath.map((p) => toPx(pl(p), cam))
  const head = simIndex < 0 ? null : pts[Math.min(simIndex, pts.length - 1)]
  let donePath = ''
  if (simIndex >= 0) {
    const cut = pts.slice(0, Math.max(1, simIndex))
    donePath = `M${cut.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}`
  }
  return { pts, head, donePath }
}

// ---------------- 网格 ----------------

export type GridLines = { v: number[]; h: number[]; label: Array<{ x: number; y: number; t: string }> }

const EMPTY_GRID: GridLines = { v: [], h: [], label: [] }

export function buildGridLines(show: boolean, b: Bounds): GridLines {
  if (!show) return EMPTY_GRID
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

/** 聚焦轮廓所需的 mm 范围；找不到（或无点）返回 null */
export function boundsOfContour(shapes: readonly Shape[], id: string): Bounds | null {
  for (const s of shapes) {
    for (const c of s.contours) {
      if (c.id !== id || c.points.length === 0) continue
      return boundsOf(c.points)
    }
  }
  return null
}
