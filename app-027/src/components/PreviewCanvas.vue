<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Pt, Shape, Sheet } from '@/logic/types'
import type { ComputedShape } from '@/logic/pipeline'
import type { Job } from '@/logic/job'
import type { CutStep } from '@/logic/order'
import { round3 } from '@/logic/geometry'
import type { SheetPlacement } from '@/logic/exporters'
import {
  INITIAL_CAMERA,
  contentBounds,
  fitView,
  focusBounds,
  toMm as mmOfPx,
  zoomAtPoint,
  zoomToAtCenter,
  type ViewSize,
} from '@/canvas/camera'
import { hitContour, pickBridgeAnchor } from '@/canvas/hitTest'
import {
  addPolygonPoint,
  beginCircle,
  beginRect,
  cancelDraft,
  emptyDraft,
  finishCircle,
  finishPolygon as commitPolygon,
  finishRect,
  updateCircle,
  updateRect,
  type DraftState,
} from '@/canvas/draft'
import {
  buildBridges,
  buildCutPaths,
  buildGridLines,
  buildMagnifiers,
  buildNumbers,
  buildOutlineContours,
  buildSimulation,
  buildTravels,
  boundsOfContour,
  collectCutSteps,
  makeProjector,
  type Mode,
} from '@/canvas/render'

type Tool = 'select' | 'rect' | 'circle' | 'polygon' | 'bridge' | 'pan'

const props = withDefaults(
  defineProps<{
    shapes: Shape[]
    computed: Map<string, ComputedShape>
    job?: Job | null
    mode?: Mode
    tool?: Tool
    sheet?: Sheet | null
    showGrid?: boolean
    showNumbers?: boolean
    showTravel?: boolean
    magnify?: boolean
    selectedContourId?: string | null
    simPath?: Pt[] | null
    simIndex?: number
    placement?: SheetPlacement | null
    statusText?: string
  }>(),
  {
    job: null,
    mode: 'outline',
    tool: 'select',
    sheet: null,
    showGrid: true,
    showNumbers: true,
    showTravel: true,
    magnify: true,
    selectedContourId: null,
    simPath: null,
    simIndex: -1,
    placement: null,
    statusText: '',
  },
)

const emit = defineEmits<{
  selectContour: [id: string, shapeId: string]
  createRect: [r: { x: number; y: number; w: number; h: number }]
  createCircle: [c: { cx: number; cy: number; r: number }]
  createPolygon: [p: Pt[]]
  manualBridge: [p: { contourId: string; atIndex: number }]
  cursor: [p: Pt]
}>()

const wrap = ref<HTMLDivElement | null>(null)
const size = ref<ViewSize>({ w: 800, h: 600 })
// 相机（mm⇄px 换算、缩放与平移）的唯一真源在 @/canvas/camera
const zoom = ref(INITIAL_CAMERA.zoom)
const panX = ref(INITIAL_CAMERA.panX)
const panY = ref(INITIAL_CAMERA.panY)
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const draft = ref<DraftState>(emptyDraft())
const hoverPt = ref<Pt | null>(null)
let ro: ResizeObserver | null = null

const bounds = computed(() => contentBounds(props.shapes, props.sheet))

function fit(): void {
  const c = cam()
  fitView(c, bounds.value, size.value)
  syncCam(c)
}

/** 以视口中心为不动点缩放（工具栏按钮 / 对外暴露） */
function zoomBy(f: number): void {
  const c = cam()
  zoomToAtCenter(c, f, size.value)
  syncCam(c)
}

/** 可变相机视图：模块函数原地更新后，再同步回各个 ref */
function cam() {
  return { zoom: zoom.value, panX: panX.value, panY: panY.value }
}
function syncCam(c: { zoom: number; panX: number; panY: number }): void {
  zoom.value = c.zoom
  panX.value = c.panX
  panY.value = c.panY
}

function localPoint(e: PointerEvent | MouseEvent): Pt {
  const el = wrap.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function toMm(p: Pt): Pt {
  return mmOfPx(p, cam())
}

onMounted(() => {
  const el = wrap.value
  if (!el) return
  ro = new ResizeObserver(() => {
    size.value = { w: el.clientWidth, h: el.clientHeight }
  })
  ro.observe(el)
  size.value = { w: el.clientWidth, h: el.clientHeight }
  fit()
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
})

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && draft.value.polygon.length >= 3) finishPolygon()
  if (e.key === 'Escape') draft.value = cancelDraft()
}

watch(
  () => [props.shapes.length, props.mode],
  () => {
    if (props.shapes.length === 0) return
    fit()
  },
)
watch(
  () => props.tool,
  () => {
    draft.value = cancelDraft()
  },
)

function capture(id: number): void {
  try {
    wrap.value?.setPointerCapture(id)
  } catch {
    // 合成事件或非活动指针时 setPointerCapture 会抛错，忽略即可
  }
}

function onDown(e: PointerEvent): void {
  const px = localPoint(e)
  const mm = toMm(px)
  if (props.tool === 'pan' || e.button === 1) {
    dragging.value = true
    dragStart.value = { x: px.x - panX.value, y: px.y - panY.value }
    capture(e.pointerId)
    return
  }
  if (props.tool === 'rect') {
    dragging.value = true
    draft.value = beginRect(draft.value, mm)
    capture(e.pointerId)
    return
  }
  if (props.tool === 'circle') {
    dragging.value = true
    draft.value = beginCircle(draft.value, mm)
    capture(e.pointerId)
    return
  }
  if (props.tool === 'polygon') {
    draft.value = addPolygonPoint(draft.value, mm)
    return
  }
  if (props.tool === 'bridge') {
    const hit = pickBridgeAnchor(mm, props.shapes, zoom.value)
    if (hit) emit('manualBridge', hit)
    return
  }
  // select
  const hit = hitContour(mm, props.shapes, zoom.value)
  if (hit) emit('selectContour', hit.contour.id, hit.shape.id)
}

function onMove(e: PointerEvent): void {
  const px = localPoint(e)
  const mm = toMm(px)
  hoverPt.value = mm
  emit('cursor', { x: round3(mm.x), y: round3(mm.y) })
  if (!dragging.value) return
  if (props.tool === 'rect' && draft.value.rect) {
    draft.value = updateRect(draft.value, mm)
    return
  }
  if (props.tool === 'circle' && draft.value.circle) {
    draft.value = updateCircle(draft.value, mm)
    return
  }
  if (props.tool === 'pan') {
    panX.value = px.x - dragStart.value.x
    panY.value = px.y - dragStart.value.y
  }
}

function onUp(): void {
  if (!dragging.value) return
  dragging.value = false
  if (props.tool === 'rect' && draft.value.rect) {
    const { next, commit } = finishRect(draft.value)
    draft.value = next
    if (commit) emit('createRect', commit)
    return
  }
  if (props.tool === 'circle' && draft.value.circle) {
    const { next, commit } = finishCircle(draft.value)
    draft.value = next
    if (commit) emit('createCircle', commit)
  }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const px = localPoint(e)
  const c = cam()
  zoomAtPoint(c, e.deltaY < 0 ? 1.12 : 1 / 1.12, px)
  syncCam(c)
}

function finishPolygon(): void {
  const { next, commit } = commitPolygon(draft.value)
  draft.value = next
  if (commit) emit('createPolygon', commit)
}

// ---------------- 渲染数据（纯计算，见 @/canvas/render） ----------------

const outlineContours = computed(() => buildOutlineContours(props.shapes, props.mode, props.selectedContourId))

const projector = computed(() => makeProjector(props.placement))
const pl = (p: Pt): Pt => projector.value(p)

const cutSteps = computed<CutStep[]>(() => collectCutSteps(props.shapes, props.computed, props.job))
const cutPaths = computed(() => buildCutPaths(cutSteps.value, pl, props.selectedContourId))
const travels = computed(() => buildTravels(cutSteps.value, pl))
const numbers = computed(() => buildNumbers(props.showNumbers, cutSteps.value, pl))
const bridges = computed(() => buildBridges(props.shapes, props.computed))
const magnifiers = computed(() => buildMagnifiers(props.magnify, props.mode, bridges.value, pl, cam(), size.value))

const simulation = computed(() => buildSimulation(props.simPath, props.simIndex, pl, cam()))
const simPts = computed(() => simulation.value.pts)
const simHead = computed(() => simulation.value.head)
const donePath = computed(() => simulation.value.donePath)

const gridLines = computed(() => buildGridLines(props.showGrid, bounds.value))

defineExpose({ fit, zoomBy, zoom, focusContour })

function focusContour(id: string): void {
  const b = boundsOfContour(props.shapes, id)
  if (!b) return
  const c = cam()
  focusBounds(c, b, size.value)
  syncCam(c)
}
</script>

<template>
  <div
    ref="wrap"
    class="canvas-wrap"
    role="application"
    aria-label="纹样刀路预览画布"
    data-testid="preview-canvas"
    tabindex="0"
    :style="{ cursor: tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }"
  >
    <svg
      :width="size.w"
      :height="size.h"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="onUp"
      @wheel="onWheel"
      @dblclick="tool === 'polygon' && finishPolygon()"
    >
      <defs>
        <clipPath v-for="m in magnifiers" :id="m.clipId" :key="m.clipId">
          <circle :cx="m.center.x" :cy="m.center.y" r="56" />
        </clipPath>
      </defs>

      <g :transform="`translate(${panX} ${panY}) scale(${zoom})`">
        <!-- 网格 -->
        <g v-if="showGrid" stroke="#212a35" stroke-width="1" vector-effect="non-scaling-stroke">
          <line v-for="x in gridLines.v" :key="`gv${x}`" :x1="x" :y1="bounds.minY - 200" :x2="x" :y2="bounds.maxY + 200" />
          <line v-for="y in gridLines.h" :key="`gh${y}`" :x1="bounds.minX - 200" :y1="y" :x2="bounds.maxX + 200" :y2="y" />
        </g>

        <!-- 纸幅 -->
        <rect
          v-if="sheet"
          :x="0"
          :y="0"
          :width="sheet.widthMm"
          :height="sheet.heightMm"
          fill="#151a20"
          stroke="#3a4654"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />

        <!-- 成品轮廓 -->
        <g v-if="mode === 'outline' || mode === 'bridge' || !job" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path
            v-for="c in outlineContours"
            :key="c.id"
            :d="c.d"
            :stroke="c.color"
            :stroke-dasharray="c.dash"
            :stroke-width="c.width"
            vector-effect="non-scaling-stroke"
          />
        </g>

        <!-- 刀路（切割顺序） -->
        <g v-if="mode === 'toolpath'" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path
            v-for="p in cutPaths"
            :key="`cut${p.i}`"
            :d="p.d"
            :stroke="p.selected ? '#47c07a' : '#ff8f3c'"
            :stroke-width="p.selected ? 2.4 : 1.7"
            vector-effect="non-scaling-stroke"
          />
        </g>

        <!-- 跳刀 -->
        <g v-if="showTravel && mode === 'toolpath'" stroke="#7f8fa3" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke">
          <line v-for="(t, i) in travels" :key="`t${i}`" :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" />
        </g>

        <!-- 顺序编号 -->
        <g v-if="mode === 'toolpath' && showNumbers">
          <g v-for="n in numbers" :key="`n${n.i}`">
            <circle :cx="n.x" :cy="n.y" :r="7 / zoom" fill="#12161b" stroke="#ff8f3c" :stroke-width="1.4 / zoom" />
            <text
              :x="n.x"
              :y="n.y + 2.6 / zoom"
              :font-size="8 / zoom"
              text-anchor="middle"
              fill="#ffb066"
              font-family="Plotter Mono, monospace"
            >
              {{ n.i }}
            </text>
          </g>
        </g>

        <!-- 连刀点缺口标记 -->
        <g v-if="mode === 'bridge'">
          <g v-for="(b, i) in bridges" :key="`b${i}`">
            <circle :cx="b.x" :cy="b.y" :r="2.4 / zoom" fill="#47c07a" />
            <circle :cx="b.end.x" :cy="b.end.y" :r="2.4 / zoom" fill="#47c07a" />
            <line :x1="b.x" :y1="b.y" :x2="b.end.x" :y2="b.end.y" stroke="#47c07a" :stroke-width="1.4 / zoom" />
          </g>
        </g>

        <!-- 仿真轨迹 -->
        <g v-if="simPts.length > 0" fill="none">
          <path :d="donePath" stroke="#47c07a" stroke-width="1.6" vector-effect="non-scaling-stroke" />
          <circle v-if="simHead" :cx="simHead.x" :cy="simHead.y" :r="5 / zoom" fill="#ff6b6b" stroke="#fff" :stroke-width="1 / zoom" />
        </g>

        <!-- 绘制中的草稿 -->
        <g v-if="draft.rect" fill="none" stroke="#5aa9ff" stroke-width="1.6" vector-effect="non-scaling-stroke">
          <rect :x="draft.rect.x" :y="draft.rect.y" :width="draft.rect.w" :height="draft.rect.h" />
        </g>
        <g v-if="draft.circle" fill="none" stroke="#5aa9ff" stroke-width="1.6" vector-effect="non-scaling-stroke">
          <circle :cx="draft.circle.cx" :cy="draft.circle.cy" :r="draft.circle.r" />
        </g>
        <g v-if="draft.polygon.length > 0" fill="none" stroke="#5aa9ff" stroke-width="1.6" vector-effect="non-scaling-stroke">
          <polyline :points="[...draft.polygon, hoverPt].filter(Boolean).map((p) => `${p!.x},${p!.y}`).join(' ')" />
          <circle v-for="(p, i) in draft.polygon" :key="`pd${i}`" :cx="p.x" :cy="p.y" :r="1.6 / zoom" fill="#5aa9ff" />
        </g>
      </g>

      <!-- 连刀点放大视图（8 倍） -->
      <g v-for="m in magnifiers" :key="m.key">
        <line
          :x1="m.anchor.x"
          :y1="m.anchor.y"
          :x2="m.center.x"
          :y2="m.center.y"
          stroke="#47c07a"
          stroke-width="1"
          stroke-dasharray="3 3"
          opacity="0.7"
        />
        <circle :cx="m.center.x" :cy="m.center.y" r="56" fill="#0d1116" stroke="#ff8f3c" stroke-width="1.6" />
        <g :clip-path="`url(#${m.clipId})`">
          <polyline
            :points="m.local.map((p) => `${p.x},${p.y}`).join(' ')"
            fill="none"
            stroke="#cfd9e4"
            stroke-width="1.6"
          />
          <line :x1="m.gapA.x" :y1="m.gapA.y" :x2="m.gapB.x" :y2="m.gapB.y" stroke="#47c07a" stroke-width="2.4" />
          <circle :cx="m.gapA.x" :cy="m.gapA.y" r="3" fill="#47c07a" />
          <circle :cx="m.gapB.x" :cy="m.gapB.y" r="3" fill="#47c07a" />
        </g>
        <text :x="m.center.x" :y="m.center.y + 68" font-size="10" text-anchor="middle" fill="#93a3b4" font-family="Plotter Mono, monospace">
          {{ m.widthMm.toFixed(2) }}mm ×8
        </text>
      </g>
    </svg>

    <div class="canvas-tools no-print">
      <button class="tiny" title="缩小" @click="zoomBy(1 / 1.2)">−</button>
      <button class="tiny" title="放大" @click="zoomBy(1.2)">＋</button>
      <button class="tiny" title="适应窗口" @click="fit">适应</button>
      <span class="zoom-label mono">{{ (zoom * 100).toFixed(0) }}%</span>
    </div>

    <div v-if="tool === 'polygon' && draft.polygon.length > 0" class="canvas-hint no-print">
      已放置 {{ draft.polygon.length }} 个点｜回车或双击完成
      <button class="tiny" @click="finishPolygon">完成</button>
    </div>

    <div class="canvas-hud no-print">
      <span v-if="statusText" class="tag">{{ statusText }}</span>
      <span class="tag mono">缩放 {{ (zoom * 100).toFixed(0) }}%</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--bg-grid);
  overflow: hidden;
  touch-action: none;
}

.canvas-wrap svg {
  display: block;
}

.canvas-hint {
  position: absolute;
  left: 50%;
  top: 8px;
  transform: translateX(-50%);
  background: rgba(18, 22, 27, 0.92);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-label {
  font-size: 11px;
  color: var(--text-dim);
  padding: 0 4px;
  min-width: 42px;
  text-align: right;
}
</style>
