// 文章から予定の項目を読み取る（ルールベース。AI が使えないときやデモで使用）
import { addDays, todayJST, weekday } from './date'
import type { Client, Kind, Staff } from './types'

export interface Parsed {
  clientId: string | null
  date: string | null
  start: number | null
  duration: number | null
  staffId: string | null
  kind: Kind | null
  weekdays: number[] | null
  interval: 1 | 2 | null
  memo: string | null
}

const WDC: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 }
const z2h = (s: string) => s.replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))

export function parseText(raw: string, clients: Client[], staff: Staff[], today = todayJST()): Parsed {
  const s = z2h(raw).replace(/\s+/g, ' ')
  const r: Parsed = { clientId: null, date: null, start: null, duration: null, staffId: null, kind: null, weekdays: null, interval: null, memo: null }

  // 利用者：姓・名・ふりがなのどれかが含まれる（長く一致したものを優先）
  let best = 0
  for (const c of clients.filter((x) => x.active)) {
    for (const part of [c.name.replace(/\s/g, ''), ...c.name.split(/\s+/), ...c.kana.split(/\s+/)]) {
      if (part.length >= 2 && s.replace(/\s/g, '').includes(part) && part.length > best) {
        best = part.length
        r.clientId = c.id
      }
    }
  }
  for (const st of staff) {
    const base = st.name.replace(/さん$/, '')
    if (s.includes(base) || s.includes(base.slice(0, 3))) r.staffId = st.id
  }

  if (/隔週/.test(s)) r.interval = 2
  else if (/毎週/.test(s)) r.interval = 1
  const wdHit = [...s.matchAll(/([日月火水木金土])(?:曜日?|[・、,／/と]|(?=[日月火水木金土]))/g)].map((m) => WDC[m[1]])
  const wdList = /(毎週|隔週)/.test(s) ? [...new Set(wdHit)] : []
  if (wdList.length) {
    r.weekdays = wdList.sort()
    r.interval ??= 1
  }

  // 時刻
  const pm = /(午後|夕方)/.test(s)
  const t1 = /(\d{1,2})[:時](\d{2})?(半)?(?!間)/.exec(s.replace(/(\d+)時間/g, ''))
  if (t1) {
    let h = Number(t1[1])
    if (pm && h < 12) h += 12
    const m = t1[2] ? Number(t1[2]) : t1[3] ? 30 : 0
    if (h < 24 && m < 60) r.start = h * 60 + m
  }
  const d1 = /(\d+)\s*時間(半)?/.exec(s)
  const d2 = /(\d+)\s*分/.exec(s)
  if (d1) r.duration = Number(d1[1]) * 60 + (d1[2] ? 30 : 0) + (d2 && !/時間\d+分/.test(s) ? 0 : d2 ? Number(d2[1]) : 0)
  else if (d2) r.duration = Number(d2[1])
  if (r.duration !== null && (r.duration < 5 || r.duration > 480)) r.duration = null

  // 日付
  if (/明後日|あさって/.test(s)) r.date = addDays(today, 2)
  else if (/明日|あした/.test(s)) r.date = addDays(today, 1)
  else if (/今日|きょう/.test(s)) r.date = today
  const md = /(\d{1,2})[/月](\d{1,2})日?/.exec(s)
  if (md) {
    const y = Number(today.slice(0, 4))
    let d = `${y}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`
    if (d < addDays(today, -60)) d = `${y + 1}${d.slice(4)}`
    r.date = d
  } else if (!r.date && /来週から/.test(s)) {
    r.date = addDays(today, 7 - ((weekday(today) + 6) % 7))
  } else if (!r.date && !wdList.length && wdHit.length && !/(来月|再来週|第\s*[一二三四五1-5])/.test(s)) {
    // 「来週水曜」「金曜」：次に来るその曜日
    const target = wdHit[0]
    let d = addDays(today, /来週/.test(s) ? 7 - ((weekday(today) + 6) % 7) : 1)
    while (weekday(d) !== target) d = addDays(d, 1)
    r.date = d
  }

  if (/リハ/.test(s)) r.kind = 'rehab'
  else if (/看護/.test(s)) r.kind = 'nursing'
  else if (/その他/.test(s)) r.kind = 'other'
  return r
}
