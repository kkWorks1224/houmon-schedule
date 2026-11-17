import { describe, expect, it } from 'vitest'
import { addDays, mondayOf, weekday } from './date'
import { MemoryDataSource } from './memory'
import { makeSeed } from './seed'
import { Service } from './service'
import { AppError, type VisitDraft } from './types'

const TODAY = '2026-11-17' // 火曜
let n = 0
const setup = () => {
  const ds = new MemoryDataSource(makeSeed(TODAY, 1000))
  let t = 2000
  return { ds, svc: new Service(ds, () => ++t, () => `id${++n}`) }
}
const draft = (p: Partial<VisitDraft> = {}): VisitDraft => ({ clientId: 'cl_sasa', date: '2026-11-18', start: 600, duration: 60, staffId: 'st_endo', kind: 'nursing', memo: '', ...p })
const monday = mondayOf(TODAY)

describe('予定の登録と重複', () => {
  it('終了時刻＝次の開始時刻は重複にしない', async () => {
    const { svc } = setup()
    // 青葉さんは月・木 9:00-10:00 遠藤さん
    const thu = addDays(monday, 3)
    expect(await svc.checkVisit(draft({ date: thu, start: 600 }))).toHaveLength(0)
    expect(await svc.checkVisit(draft({ date: thu, start: 480, duration: 60 }))).toHaveLength(0)
    const c = await svc.checkVisit(draft({ date: thu, start: 570 }))
    expect(c).toHaveLength(1)
    expect(c[0].b.clientId).toBe('cl_aoki')
  })

  it('重複があると確認なしでは保存しない', async () => {
    const { svc } = setup()
    const thu = addDays(monday, 3)
    await expect(svc.createVisit(draft({ date: thu, start: 570 }))).rejects.toMatchObject({ code: 'conflict' })
    const v = await svc.createVisit(draft({ date: thu, start: 570 }), true)
    expect(v.id).toBeTruthy()
  })

  it('自分自身の編集は重複にしない', async () => {
    const { svc } = setup()
    const v = await svc.createVisit(draft({ start: 700 }))
    const moved = await svc.updateVisit(v.id, draft({ start: 710 }), v.updatedAt)
    expect(moved.start).toBe(710)
  })

  it('ほかの端末の先行変更を検知する', async () => {
    const { svc } = setup()
    const v = await svc.createVisit(draft({ start: 700 }))
    await svc.updateVisit(v.id, draft({ start: 705 }), v.updatedAt)
    await expect(svc.updateVisit(v.id, draft({ start: 710 }), v.updatedAt)).rejects.toMatchObject({ code: 'stale' })
  })

  it('入力エラーを項目ごとに返す', async () => {
    const { svc } = setup()
    try {
      await svc.createVisit(draft({ clientId: '', duration: 0 }))
      throw new Error('should fail')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).detail).toMatchObject({ clientId: expect.any(String), duration: expect.any(String) })
    }
  })
})

describe('定期訪問', () => {
  it('複数曜日（毎週）', async () => {
    const { svc } = setup()
    const s = await svc.createSeries(draft({ clientId: 'cl_tamu', start: 420, staffId: 'st_nozomi' }), { weekdays: [1, 4], interval: 1, startDate: '2026-11-23', endDate: null })
    const occ = (await svc.range('2026-11-23', '2026-12-06')).filter((o) => o.seriesId === s.id)
    expect(occ.map((o) => o.date)).toEqual(['2026-11-23', '2026-11-26', '2026-11-30', '2026-12-03'])
  })

  it('隔週', async () => {
    const { svc } = setup()
    const s = await svc.createSeries(draft({ clientId: 'cl_tamu', start: 420 }), { weekdays: [3], interval: 2, startDate: '2026-11-18', endDate: '2026-12-31' })
    const occ = (await svc.range('2026-11-16', '2027-01-10')).filter((o) => o.seriesId === s.id).map((o) => o.date)
    expect(occ).toEqual(['2026-11-18', '2026-12-02', '2026-12-16', '2026-12-30'])
  })

  it('一括登録の重複を日付つきで返す', async () => {
    const { svc } = setup()
    const p = await svc.previewSeries(draft({ clientId: 'cl_tamu', start: 560, staffId: 'st_endo' }), { weekdays: [1], interval: 1, startDate: monday, endDate: null })
    expect(p.conflicts.length).toBeGreaterThan(10)
    expect(p.conflicts[0]).toMatchObject({ date: monday, staffId: 'st_endo', b: { clientId: 'cl_aoki' } })
    await expect(svc.createSeries(draft({ clientId: 'cl_tamu', start: 560, staffId: 'st_endo' }), { weekdays: [1], interval: 1, startDate: monday, endDate: null })).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('この回だけ／この回以降', () => {
  const thu = addDays(monday, 3)
  const nextThu = addDays(thu, 7)
  const aoki = (p: Partial<VisitDraft> = {}) => draft({ clientId: 'cl_aoki', start: 540, duration: 60, staffId: 'st_endo', ...p })

  it('この回だけの変更はほかの回に影響しない', async () => {
    const { svc } = setup()
    await svc.editOne('se_aoki', thu, aoki({ date: thu, start: 600 }))
    const occ = (await svc.range(monday, addDays(monday, 13))).filter((o) => o.clientId === 'cl_aoki')
    expect(occ.map((o) => [o.date, o.start])).toEqual([
      [monday, 540],
      [thu, 600],
      [addDays(monday, 7), 540],
      [nextThu, 540],
    ])
  })

  it('この回だけ担当者変更・お休み', async () => {
    const { svc } = setup()
    await svc.editOne('se_aoki', thu, aoki({ date: thu, staffId: 'st_muneto' }), true)
    await svc.cancel('se_aoki', nextThu, 'one')
    const occ = (await svc.range(monday, addDays(monday, 13))).filter((o) => o.clientId === 'cl_aoki')
    expect(occ.find((o) => o.date === thu)?.staffId).toBe('st_muneto')
    expect(occ.find((o) => o.date === nextThu)?.status).toBe('skipped')
    expect(occ.filter((o) => o.status === 'scheduled' && o.staffId === 'st_endo')).toHaveLength(2)
  })

  it('この回だけ：ほかの端末の先行変更を検知する', async () => {
    const { svc } = setup()
    const v1 = await svc.editOne('se_aoki', thu, aoki({ date: thu, start: 600 }))
    await svc.editOne('se_aoki', thu, aoki({ date: thu, start: 610 }), false, v1.updatedAt)
    await expect(svc.editOne('se_aoki', thu, aoki({ date: thu, start: 620 }), false, v1.updatedAt)).rejects.toMatchObject({ code: 'stale' })
  })

  it('状態を変えた直後の時刻変更（更新時刻を引き継ぐ）', async () => {
    const { svc } = setup()
    const v = await svc.createVisit(draft({ start: 700 }))
    const d = await svc.setStatus({ visitId: v.id }, 'done')
    const u = await svc.updateVisit(v.id, draft({ start: 720 }), d.updatedAt)
    expect([u.start, u.status]).toEqual([720, 'done'])
  })

  it('同じ回を2回編集しても例外は1件', async () => {
    const { svc, ds } = setup()
    await svc.editOne('se_aoki', thu, aoki({ date: thu, start: 600 }))
    await svc.editOne('se_aoki', thu, aoki({ date: thu, start: 610 }))
    expect(Object.values(ds.tables.visits).filter((v) => v.seriesId === 'se_aoki')).toHaveLength(1)
  })

  it('この回以降の変更：二重登録しない・例外を残す', async () => {
    const { svc } = setup()
    // 来週木曜だけ 10:00 に変更（例外）
    await svc.editOne('se_aoki', nextThu, aoki({ date: nextThu, start: 600 }))
    // 来週月曜以降は 毎週火曜 に変更
    const from = addDays(monday, 7)
    const plan = await svc.editFollowing('se_aoki', from, aoki(), { weekdays: [2], interval: 1, endDate: null }, true, null, true)
    expect(plan.inPlace).toBe(false)
    expect(plan.exceptions).toEqual([expect.objectContaining({ occDate: nextThu, result: 'detached' })])
    const occ = (await svc.range(monday, addDays(monday, 20))).filter((o) => o.clientId === 'cl_aoki')
    expect(occ.map((o) => [o.date, o.start])).toEqual([
      [monday, 540],
      [thu, 540],
      [addDays(monday, 8), 540],
      [nextThu, 600],
      [addDays(monday, 15), 540],
    ])
    // どの日も1件ずつ
    expect(new Set(occ.map((o) => o.date)).size).toBe(occ.length)
  })

  it('この回以降：曜日が同じなら例外は新しいルールの回として残る', async () => {
    const { svc } = setup()
    await svc.editOne('se_aoki', nextThu, aoki({ date: nextThu, start: 600 }))
    const plan = await svc.editFollowing('se_aoki', addDays(monday, 7), aoki({ start: 510 }), { weekdays: [1, 4], interval: 1, endDate: null }, true, null, true)
    expect(plan.exceptions[0].result).toBe('kept')
    const occ = (await svc.range(addDays(monday, 7), addDays(monday, 13))).filter((o) => o.clientId === 'cl_aoki')
    expect(occ.map((o) => [o.date, o.start])).toEqual([
      [addDays(monday, 7), 510],
      [nextThu, 600],
    ])
  })

  it('この回以降：例外を破棄して新しい設定にそろえる', async () => {
    const { svc } = setup()
    await svc.editOne('se_aoki', nextThu, aoki({ date: nextThu, start: 600 }))
    await svc.editFollowing('se_aoki', addDays(monday, 7), aoki({ start: 510 }), { weekdays: [1, 4], interval: 1, endDate: null }, false, null, true)
    const occ = (await svc.range(addDays(monday, 7), addDays(monday, 13))).filter((o) => o.clientId === 'cl_aoki')
    expect(occ.map((o) => o.start)).toEqual([510, 510])
  })

  it('この回以降を続けて2回変更しても重ならない', async () => {
    const { svc } = setup()
    await svc.editFollowing('se_aoki', addDays(monday, 7), aoki({ start: 600 }), { weekdays: [1, 4], interval: 1, endDate: null }, true, null, true)
    const s2 = (await svc.range(addDays(monday, 14), addDays(monday, 14))).find((o) => o.clientId === 'cl_aoki')!
    await svc.editFollowing(s2.seriesId!, addDays(monday, 14), aoki({ start: 660 }), { weekdays: [1, 4], interval: 1, endDate: null }, true, null, true)
    const occ = (await svc.range(monday, addDays(monday, 20))).filter((o) => o.clientId === 'cl_aoki')
    expect(occ.map((o) => o.start)).toEqual([540, 540, 600, 600, 660, 660])
  })

  it('隔週の分割で並びを保つ', async () => {
    const { svc } = setup()
    const before = (await svc.range(monday, addDays(monday, 55))).filter((o) => o.seriesId === 'se_eguchi').map((o) => o.date)
    const target = before[1]
    await svc.editFollowing('se_eguchi', target, draft({ clientId: 'cl_eguchi', start: 960, staffId: 'st_endo' }), { weekdays: [3], interval: 2, endDate: null }, true, null, true)
    const after = (await svc.range(monday, addDays(monday, 55))).filter((o) => o.clientId === 'cl_eguchi').map((o) => o.date)
    expect(after).toEqual(before)
    expect(before.every((d) => weekday(d) === 3)).toBe(true)
  })

  it('この回以降のお休みで定期を終了し、完了済みは残す', async () => {
    const { svc } = setup()
    await svc.setStatus({ seriesId: 'se_aoki', occDate: nextThu }, 'done')
    await svc.cancel('se_aoki', addDays(monday, 7), 'following')
    const occ = (await svc.range(monday, addDays(monday, 27))).filter((o) => o.clientId === 'cl_aoki')
    expect(occ.map((o) => [o.date, o.status])).toEqual([
      [monday, 'scheduled'],
      [thu, 'scheduled'],
      [nextThu, 'done'],
    ])
  })
})

describe('基本の週間予定', () => {
  it('2回実行しても二重に作らない', async () => {
    const { svc } = setup()
    const from = addDays(monday, 7)
    const to = addDays(monday, 20)
    const r1 = await svc.applyTemplate(from, to, 'all')
    expect(r1.created).toBe(6)
    const r2 = await svc.applyTemplate(from, to, 'all')
    expect(r2.created).toBe(0)
  })

  it('定期訪問がある日は作らない', async () => {
    const { svc } = setup()
    await svc.saveTemplate({ weekday: 1, start: 540, duration: 60, staffId: 'st_endo', clientId: 'cl_aoki', kind: 'nursing', memo: '' })
    const p = await svc.planTemplate(addDays(monday, 7), addDays(monday, 7))
    expect(p.create).toHaveLength(0)
    expect(p.skipped[0].reason).toContain('定期')
  })

  it('重複があれば確認なしでは1件も保存しない', async () => {
    const { svc, ds } = setup()
    await svc.saveTemplate({ weekday: 2, start: 600, duration: 60, staffId: 'st_muneto', clientId: 'cl_sasa', kind: 'nursing', memo: '' })
    const before = Object.keys(ds.tables.visits).length
    await expect(svc.applyTemplate(addDays(monday, 7), addDays(monday, 13), 'strict')).rejects.toMatchObject({ code: 'conflict' })
    expect(Object.keys(ds.tables.visits).length).toBe(before)
    const r = await svc.applyTemplate(addDays(monday, 7), addDays(monday, 13), 'skipConflicts')
    expect(r.created).toBe(3)
  })
})
