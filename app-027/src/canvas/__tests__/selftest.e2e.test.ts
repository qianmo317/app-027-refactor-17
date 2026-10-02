// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runSelfTest } from '@/logic/selftest'
import { DEFAULT_CUT_SETTINGS } from '@/logic/types'
import { defaultMaterials } from '@/data/materials'

// 端到端跑应用内的验收自检（HelpView 同一入口），确认画布重构未触及自检结论。
// fetchPatternText 请求 /patterns/*.svg：直接回本地 public/ 文件，绕开网络与 CORS。
describe('应用自检（与 Help 页同一 runSelfTest）', () => {
  const publicDir = resolve(process.cwd(), 'public')
  let rawFetch: typeof globalThis.fetch

  beforeAll(() => {
    rawFetch = globalThis.fetch
    globalThis.fetch = (input: RequestInfo | URL) => {
      const target = String(typeof input === 'string' ? input : 'url' in input ? input.url : '')
      const rel = target.replace(/^.*\/patterns\//, 'patterns/')
      return readFile(resolve(publicDir, rel), 'utf8').then(
        (text) => new Response(text, { status: 200 }),
        () => new Response('not found', { status: 404 }),
      )
    }
  })

  afterAll(() => {
    globalThis.fetch = rawFetch
  })

  it('全部检查通过', async () => {
    const report = await runSelfTest(DEFAULT_CUT_SETTINGS, defaultMaterials()[0])
    const failed = report.checks.filter((c) => !c.pass)
    expect(failed.map((c) => `${c.id}: ${c.detail}`)).toEqual([])
    expect(report.summaries).toHaveLength(10)
  })
})
