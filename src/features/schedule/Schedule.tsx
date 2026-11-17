import { AnimatePresence, motion, type PanInfo } from 'motion/react'
import { CalendarDays, ChevronLeft, ChevronRight, HardDrive, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, eachDay, fmtDate, fmtShort, hm, mondayOf, nowMinutesJST, todayJST, WD, weekday } from '../../../shared/date'
import type { Client, Occ, Staff } from '../../../shared/types'
import { Button, cx, IconButton, KindTag, Segmented, Skeleton, StaffMark, staffTone } from '../../components/ui'
import { clientById, loadWeek, setDate, staffById, useApp } from '../../store/app'
import { openEditor, useEditor } from '../editor/state'
import { OccCard, OccChip, RepeatBadge, StatusBadge, useClientName } from './occ'

export const DAY_START = 8 * 60 + 30
export const DAY_END = 18 * 60

function useWeekOccs(monday: string) {
  return useApp((s) => s.weeks[monday])
}

/** 担当者のその日の空き時間（30分以上） */
export function freeGaps(occs: Occ[], staffId: string, from = DAY_START, to = DAY_END) {
  const busy = occs.filter((o) => o.staffId === staffId && o.status !== 'skipped').sort((a, b) => a.start - b.start)
  const gaps: { start: number; end: number }[] = []
  let cur = from
  for (const o of busy) {
    if (o.start - cur >= 30) gaps.push({ start: cur, end: Math.min(o.start, to) })
    cur = Math.max(cur, o.end)
  }
  if (to - cur >= 30) gaps.push({ start: cur, end: to })
  return gaps.filter((g) => g.end - g.start >= 30)
}

export function Schedule() {
  const { date, view, staffFilter, query } = useApp()
  const staff = useApp((s) => s.meta.staff)
  const isDemo = useApp((s) => s.repo?.kind === 'local')
  const weekError = useApp((s) => s.weekError)
  const searchRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const today = todayJST()
  const step = view === 'day' ? 1 : 7
  const dir = useRef(0)
  const move = (n: number) => {
    dir.current = n
    setDate(addDays(date, n))
  }
  const goToday = () => {
    dir.current = date < today ? 1 : -1
    setDate(today)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || useEditor.getState().init) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return
      const k = e.key
      if (k === 'ArrowLeft') move(-step)
      else if (k === 'ArrowRight') move(step)
      else if (k === 't' || k === 'T') goToday()
      else if (k === 'd' || k === 'D') useApp.setState({ view: 'day' })
      else if (k === 'w' || k === 'W') useApp.setState({ view: 'week' })
      else if (k === '/') searchRef.current?.focus()
      else if (!e.shiftKey && /^[1-4]$/.test(k)) useApp.setState({ staffFilter: k === '1' ? 'all' : (staff[Number(k) - 2]?.id ?? 'all') })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const monday = mondayOf(date)
  const sunday = addDays(monday, 6)
  const title = view === 'day' ? fmtDate(date) : `${Number(monday.slice(5, 7))}/${Number(monday.slice(8))}〜${sunday.slice(5, 7) !== monday.slice(5, 7) ? `${Number(sunday.slice(5, 7))}/` : ''}${Number(sunday.slice(8))}`
  const visibleStaff = staffFilter === 'all' ? staff : staff.filter((s) => s.id === staffFilter)

  return (
    <div>
      {/* ツールバー（ガラス）：スクロールしても上に残る */}
      <header className="glass-flat sticky top-0 z-30 border-b border-line px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-3 lg:px-8 lg:pt-5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-baseline gap-2 truncate text-[22px] leading-tight font-bold tracking-tight lg:text-[26px]">
              <span className="truncate">{view === 'day' ? <><span className="lg:hidden">{fmtShort(date)}</span><span className="hidden lg:inline">{title}</span></> : title}</span>
              {view === 'day' && date === today && <span className="rounded-full bg-accent px-2 py-0.5 text-[12px] font-bold text-white">今日</span>}
            </h1>
            {isDemo && (
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-3 lg:hidden">
                <HardDrive size={12} aria-hidden />
                デモ：この端末にだけ保存（同期しません）
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <IconButton label={view === 'day' ? '前の日（←）' : '前の週（←）'} onClick={() => move(-step)}>
              <ChevronLeft size={22} />
            </IconButton>
            <Button variant="secondary" size="sm" onClick={goToday} disabled={view === 'day' ? date === today : monday === mondayOf(today)} title="今日（T）">
              今日
            </Button>
            <IconButton label={view === 'day' ? '次の日（→）' : '次の週（→）'} onClick={() => move(step)}>
              <ChevronRight size={22} />
            </IconButton>
            <span className="relative">
              <IconButton label="日付を選ぶ" onClick={() => dateRef.current?.showPicker?.() ?? dateRef.current?.focus()}>
                <CalendarDays size={20} />
              </IconButton>
              <input
                ref={dateRef}
                type="date"
                aria-label="日付を選ぶ"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="pointer-events-none absolute inset-0 opacity-0"
                tabIndex={-1}
              />
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex gap-2">
            <Segmented size="sm" label="表示" value={view} onChange={(v) => useApp.setState({ view: v })} options={[{ value: 'day', label: '日', aria: '日表示（D）' }, { value: 'week', label: '週', aria: '週表示（W）' }]} className="w-[104px] shrink-0" />
            <SearchBox inputRef={searchRef} />
          </div>
          <Segmented
            size="sm"
            label="担当者の絞り込み"
            value={staffFilter}
            onChange={(v) => useApp.setState({ staffFilter: v })}
            options={[{ value: 'all', label: '全員' }, ...staff.map((s) => ({ value: s.id, aria: s.name, label: <><StaffMark staff={s} size={17} /><span className="truncate">{s.name}</span></> }))]}
            className="[&_button]:flex-auto [&_button]:gap-1 [&_button]:px-1.5 [&_button]:text-[13px] lg:ml-auto lg:w-[440px] lg:[&_button]:px-3 lg:[&_button]:text-[13.5px]"
          />
        </div>
      </header>

      {weekError && (
        <p role="alert" className="mx-4 mt-3 rounded-2xl bg-bad-soft px-4 py-3 text-[14px] text-bad lg:mx-8">
          {weekError}
          <button className="ml-2 cursor-pointer font-semibold underline" onClick={() => void loadWeek(monday, true)}>
            再読み込み
          </button>
        </p>
      )}

      {query.trim() ? (
        <SearchResults q={query.trim()} />
      ) : (
        <>
          <DateStrip date={date} today={today} onPick={(d) => { dir.current = d > date ? 1 : -1; setDate(d) }} />
          <AnimatePresence mode="popLayout" initial={false} custom={dir.current}>
            <motion.div
              key={view === 'day' ? date : monday}
              custom={dir.current}
              variants={{ enter: (d: number) => ({ opacity: 0, x: d * 28 }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: d * -28, transition: { duration: 0.14 } }) }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', duration: 0.36, bounce: 0.08 }}
            >
              {view === 'day' ? <DayView date={date} staff={visibleStaff} /> : <WeekView monday={monday} staff={visibleStaff} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

function SearchBox({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const query = useApp((s) => s.query)
  return (
    <label className="relative flex h-8 min-w-0 flex-1 items-center rounded-full bg-black/[0.055] lg:w-72 lg:flex-none">
      <Search size={16} className="pointer-events-none absolute left-3 text-ink-3" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => useApp.setState({ query: e.target.value })}
        onKeyDown={(e) => e.key === 'Escape' && (useApp.setState({ query: '' }), e.currentTarget.blur())}
        placeholder="利用者名で検索（/）"
        aria-label="利用者名で検索"
        className="h-full w-full rounded-full bg-transparent pr-8 pl-9 text-[16px] outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-accent lg:text-[14px]"
      />
      {query && (
        <button type="button" aria-label="検索を消す" className="absolute right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-ink-3" onClick={() => useApp.setState({ query: '' })}>
          <X size={15} />
        </button>
      )}
    </label>
  )
}

/** スマホの日付ストリップ（週の7日。左右にスワイプで前後の週） */
function DateStrip({ date, today, onPick }: { date: string; today: string; onPick: (d: string) => void }) {
  const monday = mondayOf(date)
  const occs = useWeekOccs(monday)
  const filter = useApp((s) => s.staffFilter)
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of occs ?? []) if (o.status !== 'skipped' && (filter === 'all' || o.staffId === filter)) m[o.date] = (m[o.date] ?? 0) + 1
    return m
  }, [occs, filter])
  const onEnd = (_: unknown, i: PanInfo) => {
    if (Math.abs(i.offset.x) > 60 || Math.abs(i.velocity.x) > 500) onPick(addDays(date, i.offset.x < 0 ? 7 : -7))
  }
  return (
    <motion.div className="px-3 pt-3 lg:hidden" drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.18} dragMomentum={false} onDragEnd={onEnd} style={{ touchAction: 'pan-y' }}>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="日付">
        {[...eachDay(monday, addDays(monday, 6))].map((d) => {
          const on = d === date
          const wd = weekday(d)
          return (
            <button key={d} type="button" onClick={() => onPick(d)} aria-pressed={on} aria-label={`${fmtDate(d)} ${counts[d] ?? 0}件`} className={cx('press relative flex h-[58px] cursor-pointer flex-col items-center justify-center rounded-2xl', on ? 'text-white' : 'text-ink')}>
              {on && <motion.span layoutId="strip-on" className="absolute inset-0 rounded-2xl bg-accent shadow-[0_4px_14px_rgb(10_108_224/0.35)]" transition={{ type: 'spring', duration: 0.38, bounce: 0.18 }} />}
              <span className={cx('relative text-[11.5px] font-semibold', !on && (wd === 0 ? 'text-bad' : wd === 6 ? 'text-accent' : 'text-ink-3'))}>{WD[wd]}</span>
              <span className={cx('num relative text-[18px] leading-6 font-bold', !on && d === today && 'text-accent')}>{Number(d.slice(8))}</span>
              <span className={cx('relative mt-0.5 h-1.5 w-1.5 rounded-full', counts[d] ? (on ? 'bg-white' : 'bg-ink-3/50') : 'bg-transparent')} />
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 px-4 pt-4" aria-busy="true" aria-label="読み込み中">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-[76px] rounded-[18px]" />
      ))}
    </div>
  )
}

// ---------------- 日表示 ----------------
function DayView({ date, staff }: { date: string; staff: Staff[] }) {
  const occs = useWeekOccs(mondayOf(date))
  const day = useMemo(() => (occs ?? []).filter((o) => o.date === date), [occs, date])
  if (!occs) return <ListSkeleton />
  return (
    <>
      <div className="lg:hidden">
        <QuickAdd date={date} occs={day} />
        <DayList date={date} occs={day} staff={staff} />
      </div>
      <div className="hidden lg:block">
        <QuickAdd date={date} occs={day} />
        <DayGrid date={date} occs={day} staff={staff} />
      </div>
    </>
  )
}

/** 開いてすぐ追加：最近・よく使う利用者を1タップで（標準の担当者の空き時間を自動で入れる） */
function QuickAdd({ date, occs }: { date: string; occs: Occ[] }) {
  const clients = useApp((s) => s.meta.clients)
  const filter = useApp((s) => s.staffFilter)
  const list = useMemo(() => recentClients(clients, filter).slice(0, 10), [clients, filter])
  if (!list.length) return null
  const pick = (c: Client) => {
    const staffId = filter === 'all' ? c.defaultStaffId : filter
    openEditor({ mode: 'new', date, clientId: c.id, staffId, start: suggestStart(occs, staffId, c, date) })
  }
  return (
    <div className="px-4 pt-3 lg:px-8">
      <p className="mb-1.5 text-[12.5px] font-semibold text-ink-3" id="quick-label">
        すぐ追加（最近・よく使う利用者）
      </p>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-labelledby="quick-label">
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => pick(c)} className="press hover-lift flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-white pr-3.5 pl-1.5 text-[14.5px] font-semibold ring-1 ring-line">
            <StaffMark staff={staffById(filter === 'all' ? c.defaultStaffId : filter)} size={26} />
            {c.name.split(/\s/)[0]}さん
            <Plus size={15} className="text-ink-3" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  )
}

export function recentClients(clients: Client[], staffFilter = 'all') {
  return clients
    .filter((c) => c.active)
    .sort((a, b) => {
      const sa = (staffFilter !== 'all' && a.defaultStaffId === staffFilter ? 1e15 : 0) + a.lastUsedAt / 1000 + a.useCount * 3600 * 24
      const sb = (staffFilter !== 'all' && b.defaultStaffId === staffFilter ? 1e15 : 0) + b.lastUsedAt / 1000 + b.useCount * 3600 * 24
      return sb - sa
    })
}

/** 標準の開始時刻が空いていればそれ、無ければ最初の空き時間 */
export function suggestStart(occs: Occ[], staffId: string, c: Client, date: string) {
  const busy = occs.filter((o) => o.date === date && o.staffId === staffId && o.status !== 'skipped')
  const fits = (s: number) => !busy.some((o) => s < o.end && o.start < s + c.defaultDuration)
  if (c.defaultStart != null && fits(c.defaultStart)) return c.defaultStart
  const from = date === todayJST() ? Math.max(DAY_START, Math.ceil(nowMinutesJST() / 15) * 15) : DAY_START
  const g = freeGaps(occs.filter((o) => o.date === date), staffId, from, DAY_END).find((x) => x.end - x.start >= c.defaultDuration)
  return g?.start ?? c.defaultStart ?? DAY_START
}

function DayList({ date, occs, staff }: { date: string; occs: Occ[]; staff: Staff[] }) {
  const all = staff.length > 1
  return (
    <div className="flex flex-col gap-5 px-4 pt-4">
      {staff.map((s) => {
        const mine = occs.filter((o) => o.staffId === s.id)
        const gaps = freeGaps(occs, s.id)
        type Row = { t: 'occ'; o: Occ } | { t: 'gap'; start: number; end: number }
        const rows: Row[] = [...mine.map((o) => ({ t: 'occ' as const, o })), ...gaps.map((g) => ({ t: 'gap' as const, ...g }))].sort((a, b) => (a.t === 'occ' ? a.o.start : a.start) - (b.t === 'occ' ? b.o.start : b.start))
        const active = mine.filter((o) => o.status !== 'skipped').length
        return (
          <section key={s.id} aria-label={`${s.name}の予定`}>
            {all && (
              <h2 className="mb-2 flex items-center gap-2 px-1 text-[15px] font-bold">
                <StaffMark staff={s} size={24} />
                {s.name}
                <span className="num text-[13px] font-semibold text-ink-3">{active}件</span>
              </h2>
            )}
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {rows.map((r, i) => (r.t === 'occ' ? <OccCard key={r.o.key} o={r.o} index={i} /> : <GapRow key={`g${r.start}`} date={date} staff={s} start={r.start} end={r.end} />))}
              </AnimatePresence>
            </ul>
            {!mine.length && <p className="mt-1 px-1 text-[13px] text-ink-3">予定はありません</p>}
          </section>
        )
      })}
      <p className="pb-2 text-center text-[12px] text-ink-3">予定を右にフリックで完了、左でお休み</p>
    </div>
  )
}

function GapRow({ date, staff, start, end }: { date: string; staff: Staff; start: number; end: number }) {
  return (
    <motion.li layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="list-none">
      <button
        type="button"
        onClick={() => openEditor({ mode: 'new', date, start, staffId: staff.id })}
        className="press hover-lift flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-[16px] border-[1.5px] border-dashed border-line-strong px-3 text-left text-[14px] text-ink-3"
        aria-label={`${staff.name} ${hm(start)}から${hm(end)}が空いています。ここに予定を追加`}
      >
        <span className="num w-[54px] shrink-0 pr-2 text-right font-semibold">{hm(start)}</span>
        <span className="flex-1">
          空き <span className="num">{hm(start)}–{hm(end)}</span>
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Plus size={18} strokeWidth={2.5} />
        </span>
      </button>
    </motion.li>
  )
}

// ---------------- PC：3人を並べた時間軸 ----------------
const HOUR = 72
function DayGrid({ date, occs, staff }: { date: string; occs: Occ[]; staff: Staff[] }) {
  const name = useClientName()
  const startH = Math.min(8, ...occs.map((o) => Math.floor(o.start / 60)))
  const endH = Math.max(19, ...occs.map((o) => Math.ceil(o.end / 60)))
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i)
  const [ghost, setGhost] = useState<{ staffId: string; min: number } | null>(null)
  const today = todayJST()
  const nowMin = nowMinutesJST()
  const toMin = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const m = startH * 60 + Math.floor(((e.clientY - r.top) / HOUR) * 4) * 15
    return Math.max(0, Math.min(m, 23 * 60 + 45))
  }
  return (
    <div className="px-8 pt-4">
      <div className="surface overflow-hidden">
        <div className="grid border-b border-line" style={{ gridTemplateColumns: `56px repeat(${staff.length}, minmax(0, 1fr))` }}>
          <div />
          {staff.map((s) => (
            <div key={s.id} className="flex items-center gap-2 border-l border-line px-3 py-2.5 text-[15px] font-bold">
              <StaffMark staff={s} size={24} />
              {s.name}
              <span className="num text-[13px] font-semibold text-ink-3">{occs.filter((o) => o.staffId === s.id && o.status !== 'skipped').length}件</span>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${staff.length}, minmax(0, 1fr))` }}>
          <div className="relative" style={{ height: hours.length * HOUR }}>
            {hours.map((h, i) => (
              <span key={h} className="num absolute right-2 -translate-y-1/2 text-[12px] text-ink-3" style={{ top: i * HOUR }}>
                {i === 0 ? '' : `${h}:00`}
              </span>
            ))}
          </div>
          {staff.map((s) => {
            const mine = occs.filter((o) => o.staffId === s.id)
            const lanes = layoutLanes(mine)
            return (
              <div
                key={s.id}
                className="relative cursor-copy border-l border-line"
                style={{ height: hours.length * HOUR, backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line) 0 1px, transparent 1px ${HOUR / 2}px)` }}
                onMouseMove={(e) => setGhost({ staffId: s.id, min: toMin(e) })}
                onMouseLeave={() => setGhost(null)}
                onClick={(e) => openEditor({ mode: 'new', date, staffId: s.id, start: toMin(e) })}
                role="presentation"
              >
                {ghost?.staffId === s.id && (
                  <div className="pointer-events-none absolute inset-x-1 flex items-center gap-1 rounded-lg bg-accent-soft/80 px-2 text-[12.5px] font-semibold text-accent-ink ring-1 ring-accent/30" style={{ top: ((ghost.min - startH * 60) / 60) * HOUR, height: HOUR / 4 }}>
                    <Plus size={13} aria-hidden />
                    <span className="num">{hm(ghost.min)}</span>に追加
                  </div>
                )}
                {date === today && nowMin > startH * 60 && nowMin < endH * 60 && <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-bad" style={{ top: ((nowMin - startH * 60) / 60) * HOUR }} aria-hidden />}
                {mine.map((o) => {
                  const lane = lanes.get(o.key)!
                  const tone = staffTone(staffById(o.staffId))
                  const h = Math.max(26, (o.duration / 60) * HOUR - 3)
                  return (
                    <motion.button
                      key={o.key}
                      layout
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditor({ mode: 'edit', occ: o })
                      }}
                      onMouseMove={(e) => e.stopPropagation()}
                      onMouseEnter={() => setGhost(null)}
                      className={cx('press absolute cursor-pointer overflow-hidden rounded-[10px] border-l-[4px] px-2 py-1 text-left shadow-[0_1px_2px_rgb(15_23_42/0.08)] ring-1 ring-line', tone.soft, o.status === 'skipped' && 'skipped-stripes bg-[#f6f6f7] opacity-70', o.status === 'done' && 'opacity-75')}
                      style={{ top: ((o.start - startH * 60) / 60) * HOUR + 1, height: h, left: `calc(${(lane.i / lane.n) * 100}% + 3px)`, width: `calc(${100 / lane.n}% - 6px)`, borderLeftColor: `var(--color-st${((staffById(o.staffId)?.sort ?? 1) - 1) % 3 + 1})` }}
                      title={`${hm(o.start)}–${hm(o.end)} ${name(o.clientId)}`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="num shrink-0 text-[12.5px] font-bold">{hm(o.start)}–{hm(o.end)}</span>
                        <span className={cx('min-w-0 truncate text-[13.5px] font-bold', o.status === 'skipped' && 'line-through')}>{name(o.clientId)}</span>
                        <KindTag kind={o.kind} />
                      </span>
                      {h > 40 && (
                        <span className="mt-0.5 flex min-w-0 items-center gap-2">
                          <StatusBadge o={o} />
                          <RepeatBadge o={o} />
                          {o.memo && <span className="truncate text-[12px] text-ink-2">{o.memo}</span>}
                        </span>
                      )}
                    </motion.button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <p className="mt-2 text-[12.5px] text-ink-3">空いている時間を押すと、その時刻・担当者で予定を追加します（15分単位）。</p>
    </div>
  )
}

/** 重なった予定を横に並べる（重複がひと目で分かるように） */
function layoutLanes(list: Occ[]) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.duration - a.duration)
  const res = new Map<string, { i: number; n: number }>()
  let group: Occ[] = []
  let groupEnd = -1
  const flush = () => {
    const laneEnds: number[] = []
    const idx = new Map<string, number>()
    for (const o of group) {
      let li = laneEnds.findIndex((e) => e <= o.start)
      if (li < 0) li = laneEnds.push(0) - 1
      laneEnds[li] = o.end
      idx.set(o.key, li)
    }
    for (const o of group) res.set(o.key, { i: idx.get(o.key)!, n: laneEnds.length })
    group = []
  }
  for (const o of sorted) {
    if (o.start >= groupEnd && group.length) flush()
    group.push(o)
    groupEnd = Math.max(groupEnd, o.end)
  }
  if (group.length) flush()
  return res
}

// ---------------- 週表示 ----------------
function WeekView({ monday, staff }: { monday: string; staff: Staff[] }) {
  const occs = useWeekOccs(monday)
  const today = todayJST()
  const days = [...eachDay(monday, addDays(monday, 6))]
  if (!occs) return <ListSkeleton />
  const toDay = (d: string) => useApp.setState({ view: 'day', date: d })
  return (
    <>
      {/* スマホ：日ごとのリスト */}
      <div className="flex flex-col gap-4 px-4 pt-4 lg:hidden">
        {days.map((d) => {
          const list = occs.filter((o) => o.date === d && staff.some((s) => s.id === o.staffId))
          return (
            <section key={d} aria-label={fmtDate(d)}>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <button type="button" onClick={() => toDay(d)} className={cx('cursor-pointer text-[15px] font-bold', d === today && 'text-accent')}>
                  {fmtShort(d)}
                  <span className="num ml-2 text-[13px] font-semibold text-ink-3">{list.filter((o) => o.status !== 'skipped').length}件</span>
                </button>
                <Button variant="ghost" size="sm" icon={<Plus size={16} />} onClick={() => openEditor({ mode: 'new', date: d, staffId: staff.length === 1 ? staff[0].id : undefined })}>
                  追加
                </Button>
              </div>
              {list.length ? (
                <div className="flex flex-col gap-1.5">
                  {list.map((o) => (
                    <OccChip key={o.key} o={o} withStaff />
                  ))}
                </div>
              ) : (
                <p className="px-1 text-[13px] text-ink-3">予定はありません</p>
              )}
            </section>
          )
        })}
      </div>
      {/* PC：担当者 × 曜日 */}
      <div className="hidden px-8 pt-4 lg:block">
        <div className="surface overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: `120px repeat(7, minmax(0, 1fr))` }}>
            <div className="border-b border-line" />
            {days.map((d) => (
              <button key={d} type="button" onClick={() => toDay(d)} className={cx('hover-lift cursor-pointer border-b border-l border-line px-2 py-2 text-left text-[14px] font-bold', d === today && 'text-accent')} title="日表示へ">
                {fmtShort(d)}
              </button>
            ))}
            {staff.map((s) => (
              <WeekRow key={s.id} s={s} days={days} occs={occs} />
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12.5px] text-ink-3">枠の空いているところを押すと、その日・担当者で予定を追加します。</p>
      </div>
    </>
  )
}

function WeekRow({ s, days, occs }: { s: Staff; days: string[]; occs: Occ[] }) {
  return (
    <>
      <div className="flex items-start gap-2 border-b border-line px-3 py-3 text-[14px] font-bold">
        <StaffMark staff={s} size={22} />
        {s.name}
      </div>
      {days.map((d) => {
        const list = occs.filter((o) => o.date === d && o.staffId === s.id)
        return (
          <div key={d} role="presentation" onClick={() => openEditor({ mode: 'new', date: d, staffId: s.id })} className="group flex min-h-[120px] cursor-copy flex-col gap-1 border-b border-l border-line p-1.5">
            {list.map((o) => (
              <OccChip key={o.key} o={o} />
            ))}
            <span className="mt-auto flex h-7 items-center justify-center rounded-lg text-[12.5px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
              <Plus size={14} />
              追加
            </span>
          </div>
        )
      })}
    </>
  )
}

// ---------------- 検索 ----------------
function SearchResults({ q }: { q: string }) {
  const clients = useApp((s) => s.meta.clients)
  const repo = useApp((s) => s.repo)
  const norm = (s: string) => s.replace(/\s/g, '')
  const hits = clients.filter((c) => norm(c.name).includes(norm(q)) || norm(c.kana).includes(norm(q)))
  const [sel, setSel] = useState<string | null>(null)
  const [list, setList] = useState<Occ[] | null>(null)
  const today = todayJST()
  const target = sel ?? (hits.length === 1 ? hits[0].id : null)
  useEffect(() => {
    if (!target || !repo) return
    setList(null)
    let live = true
    repo
      .call('range', addDays(today, -14), addDays(today, 62))
      .then((r) => live && setList(r.filter((o) => o.clientId === target)))
      .catch(() => live && setList([]))
    return () => {
      live = false
    }
  }, [target, repo, today])
  return (
    <div className="px-4 pt-4 lg:px-8">
      {!hits.length && <p className="text-[14px] text-ink-3">「{q}」に一致する利用者はいません</p>}
      {hits.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {hits.map((c) => (
            <button key={c.id} type="button" onClick={() => setSel(c.id)} aria-pressed={target === c.id} className={cx('press h-10 cursor-pointer rounded-full px-4 text-[14.5px] font-semibold ring-1', target === c.id ? 'bg-accent text-white ring-accent' : 'bg-white ring-line')}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {target && (
        <section aria-label="検索結果">
          <h2 className="mb-2 text-[17px] font-bold">{clientById(target)?.name}さんの予定（前後2週〜2か月）</h2>
          {!list ? (
            <ListSkeleton />
          ) : list.length ? (
            <ul className="flex flex-col gap-1.5">
              {list.map((o) => (
                <li key={o.key} className={cx('flex items-center gap-3', o.date < today && 'opacity-60')}>
                  <span className={cx('num w-[86px] shrink-0 text-[13.5px] font-semibold', o.date === today && 'text-accent')}>{fmtShort(o.date)}</span>
                  <div className="min-w-0 flex-1">
                    <OccChip o={o} withStaff />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-ink-3">この期間の予定はありません</p>
          )}
        </section>
      )}
    </div>
  )
}

