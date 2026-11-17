// 日付は Asia/Tokyo の暦日を 'YYYY-MM-DD' 文字列で扱う（タイムゾーンの影響を受けないよう UTC で計算）

const pad = (n: number) => String(n).padStart(2, '0')

export function todayJST(now = Date.now()): string {
  const d = new Date(now + 9 * 3600e3)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function nowMinutesJST(now = Date.now()): number {
  const d = new Date(now + 9 * 3600e3)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

const toUTC = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUTC = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTC(s)) && fromUTC(toUTC(s)) === s
export const addDays = (s: string, n: number) => fromUTC(toUTC(s) + n * 864e5)
export const diffDays = (a: string, b: string) => Math.round((toUTC(a) - toUTC(b)) / 864e5)
/** 0=日 … 6=土 */
export const weekday = (s: string) => new Date(toUTC(s)).getUTCDay()
/** その週の月曜日 */
export const mondayOf = (s: string) => addDays(s, -((weekday(s) + 6) % 7))
export const addMonths = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`
}

export function* eachDay(from: string, to: string) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d
}

export const WD = ['日', '月', '火', '水', '木', '金', '土']
/** 月曜始まりの並び */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

export const hm = (min: number) => `${Math.floor(min / 60)}:${pad(min % 60)}`
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
export const parseHm = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  return h < 24 && mi < 60 ? h * 60 + mi : null
}

export function fmtDate(s: string, opt: { year?: boolean; weekday?: boolean } = { weekday: true }) {
  const [y, m, d] = s.split('-').map(Number)
  return `${opt.year ? `${y}年` : ''}${m}月${d}日${opt.weekday === false ? '' : `（${WD[weekday(s)]}）`}`
}
export const fmtShort = (s: string) => {
  const [, m, d] = s.split('-').map(Number)
  return `${m}/${d}（${WD[weekday(s)]}）`
}
export const fmtDuration = (min: number) => (min % 60 === 0 ? `${min / 60}時間` : min > 60 ? `${Math.floor(min / 60)}時間${min % 60}分` : `${min}分`)
