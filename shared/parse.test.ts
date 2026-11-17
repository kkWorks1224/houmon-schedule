import { describe, expect, it } from 'vitest'
import { parseText } from './parse'
import { CLIENTS, STAFF } from './seed'

const T = '2026-11-17'
describe('文章からの読み取り', () => {
  it('定期の例', () => {
    const r = parseText('青葉さん、毎週月曜・木曜、9:00から60分、遠藤さん', CLIENTS, STAFF, T)
    expect(r).toMatchObject({ clientId: 'cl_aoki', weekdays: [1, 4], interval: 1, start: 540, duration: 60, staffId: 'st_endo' })
  })
  it('隔週・午後・時間表記', () => {
    const r = parseText('石川 隔週水曜 午後2時半 1時間30分 のぞみん リハ', CLIENTS, STAFF, T)
    expect(r).toMatchObject({ clientId: 'cl_ishi', weekdays: [3], interval: 2, start: 870, duration: 90, staffId: 'st_nozomi', kind: 'rehab' })
  })
  it('単発・明日', () => {
    const r = parseText('明日 10時 島田さん 45分 むねと', CLIENTS, STAFF, T)
    expect(r).toMatchObject({ clientId: 'cl_shimi', date: '2026-11-18', start: 600, duration: 45, staffId: 'st_muneto', weekdays: null })
  })
  it('あいまいな日付は推測しない', () => {
    expect(parseText('小森さんを来月の第一水曜にリハで', CLIENTS, STAFF, T)).toMatchObject({ date: null, weekdays: null, kind: 'rehab' })
  })
  it('来週から', () => {
    expect(parseText('笹本さん 毎週月曜と木曜 午後5時から30分 のぞみん 来週から', CLIENTS, STAFF, T)).toMatchObject({ date: '2026-11-23', weekdays: [1, 4], start: 1020, duration: 30, staffId: 'st_nozomi' })
  })
  it('日付指定と来週の曜日', () => {
    expect(parseText('11/20 9時半 笹本', CLIENTS, STAFF, T)).toMatchObject({ date: '2026-11-20', start: 570, clientId: 'cl_sasa' })
    expect(parseText('来週水曜 13時 上原', CLIENTS, STAFF, T)).toMatchObject({ date: '2026-11-25', start: 780 })
  })
})
