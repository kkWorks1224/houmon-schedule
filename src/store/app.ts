import { create } from 'zustand'
import { addDays, mondayOf, todayJST } from '../../shared/date'
import type { Client, Occ, Series, Staff, Status, TemplateSlot, Visit } from '../../shared/types'
import { ApiRepo, LocalRepo, type Repo } from '../lib/repo'

export type Phase = 'checking' | 'login' | 'notMember' | 'loading' | 'ready' | 'error'
export type Tab = 'schedule' | 'series' | 'clients' | 'settings'
export type View = 'day' | 'week'

interface Meta {
  staff: Staff[]
  clients: Client[]
  series: Series[]
  templates: TemplateSlot[]
}

interface State {
  phase: Phase
  repo: Repo | null
  user: { email: string; name: string; picture: string } | null
  role: 'admin' | 'staff' | null
  bootError: string
  meta: Meta
  /** 週（月曜日）ごとの予定 */
  weeks: Record<string, Occ[]>
  loadingWeeks: Record<string, boolean>
  weekError: string
  // 画面の状態（保存後も維持する）
  tab: Tab
  view: View
  date: string
  staffFilter: string
  query: string
}

const UI_KEY = 'houmon-ui-v1'
const loadUi = (): Partial<State> => {
  try {
    const u = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')
    return { view: u.view === 'week' ? 'week' : 'day', staffFilter: typeof u.staffFilter === 'string' ? u.staffFilter : 'all' }
  } catch {
    return {}
  }
}

export const useApp = create<State>(() => ({
  phase: 'checking',
  repo: null,
  user: null,
  role: null,
  bootError: '',
  meta: { staff: [], clients: [], series: [], templates: [] },
  weeks: {},
  loadingWeeks: {},
  weekError: '',
  tab: 'schedule',
  view: 'day',
  date: todayJST(),
  staffFilter: 'all',
  query: '',
  ...loadUi(),
}))

useApp.subscribe((s, p) => {
  if (s.view !== p.view || s.staffFilter !== p.staffFilter) {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ view: s.view, staffFilter: s.staffFilter }))
    } catch {
      /* noop */
    }
  }
})

const set = useApp.setState
const get = useApp.getState
export const repo = () => get().repo!

const DEMO_FLAG = 'houmon-demo-mode'
export const isDemoChosen = () => {
  try {
    return localStorage.getItem(DEMO_FLAG) === '1'
  } catch {
    return false
  }
}

export async function boot() {
  set({ phase: 'checking' })
  if (isDemoChosen()) return start(new LocalRepo(), null, null)
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' })
    const me = (await r.json()) as { user: State['user']; role: State['role'] }
    if (!me.user) return set({ phase: 'login' })
    if (!me.role) return set({ phase: 'notMember', user: me.user })
    return start(new ApiRepo(), me.user, me.role)
  } catch {
    // サーバに届かない（オフラインやローカルの静的配信）ときはログイン画面からデモを選べる
    set({ phase: 'login' })
  }
}

export function startDemo() {
  try {
    localStorage.setItem(DEMO_FLAG, '1')
  } catch {
    /* noop */
  }
  void start(new LocalRepo(), null, null)
}
export function leaveDemo() {
  try {
    localStorage.removeItem(DEMO_FLAG)
  } catch {
    /* noop */
  }
  location.reload()
}

async function start(r: Repo, user: State['user'], role: State['role']) {
  set({ repo: r, user, role, phase: 'loading', weeks: {} })
  try {
    // 初回はサーバが担当者・デモデータを用意するので、先にメタ情報を読む
    await refreshMeta()
    await loadWeek(mondayOf(get().date), true)
    if (get().weekError) throw new Error(get().weekError)
    set({ phase: 'ready' })
    prefetchAround(get().date)
  } catch (e) {
    set({ phase: 'error', bootError: e instanceof Error ? e.message : '読み込めませんでした' })
  }
}

export async function refreshMeta() {
  const m = await repo().call('bootstrap')
  set({ meta: m })
}

export async function loadWeek(monday: string, force = false) {
  const s = get()
  if (!force && (s.weeks[monday] || s.loadingWeeks[monday])) return
  set((st) => ({ loadingWeeks: { ...st.loadingWeeks, [monday]: true } }))
  try {
    const list = await repo().call('range', monday, addDays(monday, 6))
    set((st) => ({ weeks: { ...st.weeks, [monday]: list }, weekError: '' }))
  } catch (e) {
    set({ weekError: e instanceof Error ? e.message : '予定を読み込めませんでした' })
  } finally {
    set((st) => ({ loadingWeeks: { ...st.loadingWeeks, [monday]: false } }))
  }
}

export function prefetchAround(date: string) {
  const m = mondayOf(date)
  void loadWeek(addDays(m, -7))
  void loadWeek(addDays(m, 7))
}

/** 変更後：表示中の週と前後を読み直す（表示は古いまま残し、ちらつかせない） */
export async function afterChange(dates: string[] = []) {
  const keep = new Set([mondayOf(get().date), ...dates.map(mondayOf)])
  set((st) => ({ weeks: Object.fromEntries(Object.entries(st.weeks).filter(([k]) => keep.has(k))) }))
  await Promise.all([...[...keep].map((m) => loadWeek(m, true)), refreshMeta()])
  prefetchAround(get().date)
}

export function setDate(date: string) {
  set({ date })
  void loadWeek(mondayOf(date))
  prefetchAround(date)
}

/** フリック：すぐ画面に反映し、保存に失敗したら戻す */
export async function setOccStatus(o: Occ, status: Status): Promise<Visit> {
  const m = mondayOf(o.date)
  const patch = (st: Status) => set((s) => ({ weeks: { ...s.weeks, [m]: (s.weeks[m] ?? []).map((x) => (x.key === o.key ? { ...x, status: st } : x)) } }))
  patch(status)
  try {
    const v = await repo().call('setStatus', { visitId: o.visitId, seriesId: o.seriesId, occDate: o.occDate }, status)
    void loadWeek(m, true)
    return v
  } catch (e) {
    patch(o.status)
    throw e
  }
}

export const staffById = (id: string) => get().meta.staff.find((s) => s.id === id)
export const clientById = (id: string) => get().meta.clients.find((c) => c.id === id)
