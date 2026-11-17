import { addDays, diffDays, eachDay, mondayOf, weekday } from './date'
import type { Conflict, Occ, Series, Visit } from './types'

/** 定期ルールの発生日（from〜to の範囲だけ） */
export function expandSeries(s: Series, from: string, to: string): string[] {
  const lo = s.startDate > from ? s.startDate : from
  const hi = s.endDate && s.endDate < to ? s.endDate : to
  if (lo > hi || s.weekdays.length === 0) return []
  const out: string[] = []
  for (const d of eachDay(lo, hi)) {
    if (!s.weekdays.includes(weekday(d))) continue
    if (s.interval === 2) {
      const weeks = Math.round(diffDays(mondayOf(d), s.anchor) / 7)
      if (((weeks % 2) + 2) % 2 !== 0) continue
    }
    out.push(d)
  }
  return out
}

/** 直近の発生日を n 件（確認用） */
export function nextOccurrences(s: Series, from: string, n: number, horizonDays = 400): string[] {
  const start = s.startDate > from ? s.startDate : from
  const out: string[] = []
  let cursor = start
  while (out.length < n && diffDays(cursor, start) < horizonDays) {
    const end = addDays(cursor, 27)
    out.push(...expandSeries(s, cursor, end))
    cursor = addDays(end, 1)
  }
  return out.slice(0, n)
}

export const occKey = (seriesId: string, date: string) => `s:${seriesId}:${date}`

const fromVisit = (v: Visit): Occ => ({
  key: v.seriesId && v.occDate ? occKey(v.seriesId, v.occDate) : v.id,
  visitId: v.id,
  seriesId: v.seriesId,
  occDate: v.occDate,
  date: v.date,
  start: v.start,
  duration: v.duration,
  end: v.start + v.duration,
  staffId: v.staffId,
  clientId: v.clientId,
  kind: v.kind,
  memo: v.memo,
  status: v.status,
  exception: !!v.seriesId,
  updatedAt: v.updatedAt,
})

export const fromSeries = (s: Series, date: string): Occ => ({
  key: occKey(s.id, date),
  visitId: null,
  seriesId: s.id,
  occDate: date,
  date,
  start: s.start,
  duration: s.duration,
  end: s.start + s.duration,
  staffId: s.staffId,
  clientId: s.clientId,
  kind: s.kind,
  memo: s.memo,
  status: 'scheduled',
  exception: false,
  updatedAt: s.updatedAt,
})

/**
 * 表示期間の訪問を組み立てる。
 * visits には「date が期間内」または「occDate が期間内」の行を渡す（日付を移した例外も正しく扱うため）。
 */
export function buildOccurrences(series: Series[], visits: Visit[], from: string, to: string): Occ[] {
  const overridden = new Set<string>()
  const byId = new Map(series.map((s) => [s.id, s]))
  const out: Occ[] = []
  for (const v of visits) {
    if (v.seriesId && v.occDate) overridden.add(occKey(v.seriesId, v.occDate))
    if (v.date >= from && v.date <= to) {
      const o = fromVisit(v)
      // 状態（完了・お休み）だけの記録は「変更あり」にしない
      const s = v.seriesId ? byId.get(v.seriesId) : undefined
      if (s) o.exception = v.date !== v.occDate || v.start !== s.start || v.duration !== s.duration || v.staffId !== s.staffId || v.kind !== s.kind || v.memo !== s.memo
      out.push(o)
    }
  }
  for (const s of series) {
    for (const d of expandSeries(s, from, to)) {
      if (!overridden.has(occKey(s.id, d))) out.push(fromSeries(s, d))
    }
  }
  return sortOccs(out)
}

export const sortOccs = (list: Occ[]) => list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start || a.staffId.localeCompare(b.staffId)))

/** 同じ担当者・同じ日に時間が重なるか（終了＝次の開始は重ならない） */
export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end

export interface Candidate {
  date: string
  start: number
  end: number
  staffId: string
  clientId: string
  /** 自分自身（編集中の予定）と比べないためのキー */
  key?: string
}

/**
 * 候補の予定と既存の予定の重なりを探す。お休みの回は数えない。
 * ignore に入ったキーの既存予定（編集で置き換わるもの）は比較しない。
 */
export function findConflicts(cands: Candidate[], existing: Occ[], ignore: (o: Occ) => boolean = () => false): Conflict[] {
  const byDay = new Map<string, Occ[]>()
  for (const o of existing) {
    if (o.status === 'skipped' || ignore(o)) continue
    const k = `${o.date}|${o.staffId}`
    const arr = byDay.get(k)
    if (arr) arr.push(o)
    else byDay.set(k, [o])
  }
  const out: Conflict[] = []
  for (const c of cands) {
    for (const o of byDay.get(`${c.date}|${c.staffId}`) ?? []) {
      if (c.key && o.key === c.key) continue
      if (overlaps(c, o)) out.push({ date: c.date, staffId: c.staffId, a: { clientId: c.clientId, start: c.start, end: c.end }, b: { clientId: o.clientId, start: o.start, end: o.end, key: o.key } })
    }
  }
  // 候補どうし（一括登録の中での重なり）
  const sorted = [...cands].sort((x, y) => (x.date + x.staffId < y.date + y.staffId ? -1 : x.date + x.staffId > y.date + y.staffId ? 1 : x.start - y.start))
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].date === sorted[i].date && sorted[j].staffId === sorted[i].staffId; j++) {
      if (overlaps(sorted[i], sorted[j])) out.push({ date: sorted[i].date, staffId: sorted[i].staffId, a: { clientId: sorted[j].clientId, start: sorted[j].start, end: sorted[j].end }, b: { clientId: sorted[i].clientId, start: sorted[i].start, end: sorted[i].end, key: 'new' } })
    }
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.a.start - y.a.start))
}
