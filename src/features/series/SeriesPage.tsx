import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, CalendarPlus, Plus, Repeat, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { addDays, fmtShort, hhmm, hm, mondayOf, parseHm, todayJST, WD, WEEK_ORDER } from '../../../shared/date'
import { fromSeries, nextOccurrences } from '../../../shared/engine'
import type { TemplatePlan } from '../../../shared/service'
import { AppError, KIND_LABEL, type Kind, type Series, type TemplateSlot } from '../../../shared/types'
import { Button, cx, Field, inputCls, KindTag, Segmented, Sheet, StaffMark, StaffTag, toast } from '../../components/ui'
import { errMessage } from '../../lib/repo'
import { afterChange, clientById, repo, staffById, useApp } from '../../store/app'
import { seriesText } from '../editor/Editor'
import { openEditor } from '../editor/state'

export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="glass-flat sticky top-0 z-30 flex items-center gap-3 border-b border-line px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 lg:px-8 lg:pt-5">
      <h1 className="flex-1 text-[22px] font-bold tracking-tight lg:text-[26px]">{title}</h1>
      {action}
    </header>
  )
}

export function SeriesPage() {
  const [tab, setTab] = useState<'series' | 'template'>('series')
  return (
    <div>
      <PageHeader
        title="定期訪問"
        action={
          tab === 'series' ? (
            <Button size="sm" icon={<Plus size={16} strokeWidth={2.5} />} onClick={() => openEditor({ mode: 'new', date: todayJST(), repeat: true })}>
              定期訪問を登録
            </Button>
          ) : null
        }
      />
      <div className="px-4 pt-3 lg:px-8">
        <Segmented label="表示" value={tab} onChange={setTab} options={[{ value: 'series', label: '定期訪問の一覧' }, { value: 'template', label: '基本の週間予定' }]} className="max-w-md" />
      </div>
      {tab === 'series' ? <SeriesList /> : <TemplateView />}
    </div>
  )
}

function SeriesList() {
  const series = useApp((s) => s.meta.series)
  const clients = useApp((s) => s.meta.clients)
  const today = todayJST()
  const groups = useMemo(() => {
    const active = series.filter((s) => !s.endDate || s.endDate >= today)
    const by = new Map<string, Series[]>()
    for (const s of active) by.set(s.clientId, [...(by.get(s.clientId) ?? []), s])
    return [...by.entries()].sort((a, b) => (clientById(a[0])?.kana ?? '').localeCompare(clientById(b[0])?.kana ?? '', 'ja'))
  }, [series, today, clients])
  const edit = async (s: Series) => {
    const next = nextOccurrences(s, today, 1)[0]
    if (!next) return toast('今後の回がありません', 'info')
    // その回に個別の変更があれば、それを開く
    const occ = (await repo().call('range', next, next).catch(() => [])).find((o) => o.seriesId === s.id && o.occDate === next)
    openEditor({ mode: 'edit', occ: occ ?? fromSeries(s, next) })
  }
  return (
    <div className="px-4 pt-4 lg:px-8">
      <p className="mb-3 text-[13px] text-ink-3">押すと次の回を開きます。保存時に「この回だけ」か「この回以降」を選べます。</p>
      {!groups.length && <p className="text-[14px] text-ink-3">定期訪問はまだありません</p>}
      <ul className="grid gap-2.5 lg:grid-cols-2">
        {groups.map(([cid, list]) => (
          <li key={cid} className="surface p-3.5">
            <p className="mb-2 text-[16.5px] font-bold">{clientById(cid)?.name ?? '（削除された利用者）'}さん</p>
            <ul className="flex flex-col gap-1.5">
              {list
                .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
                .map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => void edit(s)} className="press hover-lift flex w-full cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[12px] bg-sunken/70 px-3 py-2.5 text-left">
                      <Repeat size={15} className="text-ink-3" aria-hidden />
                      <span className="text-[15px] font-bold">{seriesText(s)}</span>
                      <span className="num text-[15px] font-semibold">
                        {hm(s.start)}–{hm(s.start + s.duration)}
                      </span>
                      <KindTag kind={s.kind} />
                      <StaffTag staff={staffById(s.staffId)} />
                      <span className="num w-full text-[12.5px] text-ink-3">
                        {fmtShort(s.startDate)}〜{s.endDate ? fmtShort(s.endDate) : '終了日なし'}
                        {s.startDate > today && '（これから開始）'}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------- 基本の週間予定 ----------------
function TemplateView() {
  const templates = useApp((s) => s.meta.templates)
  const [edit, setEdit] = useState<Partial<TemplateSlot> | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  return (
    <div className="px-4 pt-4 lg:px-8">
      <p className="mb-3 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
        毎週の基本の予定を曜日ごとに登録しておき、期間を指定して予定をまとめて作れます。その日に同じ利用者の予定（定期訪問の回・お休みの回・前に作った予定）があれば作りません。
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button icon={<CalendarPlus size={17} />} onClick={() => setApplyOpen(true)} disabled={!templates.length}>
          期間を指定して予定を作成
        </Button>
        <Button variant="secondary" icon={<Plus size={17} />} onClick={() => setEdit({ weekday: 1, start: 540, duration: 60, kind: 'nursing', memo: '' })}>
          枠を追加
        </Button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {WEEK_ORDER.map((w) => {
          const list = templates.filter((t) => t.weekday === w).sort((a, b) => a.start - b.start)
          return (
            <section key={w} className="surface p-3" aria-label={`${WD[w]}曜日`}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[15px] font-bold">{WD[w]}曜日</h2>
                <button type="button" aria-label={`${WD[w]}曜日に枠を追加`} onClick={() => setEdit({ weekday: w, start: 540, duration: 60, kind: 'nursing', memo: '' })} className="press flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-accent hover:bg-accent-soft">
                  <Plus size={17} />
                </button>
              </div>
              <ul className="flex flex-col gap-1.5">
                {list.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setEdit(t)} className="press hover-lift flex w-full cursor-pointer items-center gap-1.5 rounded-[10px] bg-sunken/70 px-2 py-2 text-left text-[13.5px]">
                      <StaffMark staff={staffById(t.staffId)} size={20} />
                      <span className="num font-bold">{hm(t.start)}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{clientById(t.clientId)?.name}</span>
                      <KindTag kind={t.kind} />
                    </button>
                  </li>
                ))}
                {!list.length && <li className="text-[12.5px] text-ink-3">なし</li>}
              </ul>
            </section>
          )
        })}
      </div>
      <SlotSheet slot={edit} onClose={() => setEdit(null)} />
      <ApplySheet open={applyOpen} onClose={() => setApplyOpen(false)} />
    </div>
  )
}

function SlotSheet({ slot, onClose }: { slot: Partial<TemplateSlot> | null; onClose: () => void }) {
  const meta = useApp((s) => s.meta)
  const [v, setV] = useState<Partial<TemplateSlot>>({})
  const [err, setErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [seen, setSeen] = useState<Partial<TemplateSlot> | null>(null)
  if (slot !== seen) {
    setSeen(slot)
    setV(slot ? { staffId: meta.staff[0]?.id, ...slot } : {})
    setErr({})
  }
  const clients = meta.clients.filter((c) => c.active).sort((a, b) => a.kana.localeCompare(b.kana, 'ja'))
  const save = async () => {
    if (!v.clientId) return setErr({ clientId: '利用者を選んでください' })
    setBusy(true)
    try {
      await repo().call('saveTemplate', v as TemplateSlot)
      await afterChange()
      toast('週間予定の枠を保存しました')
      onClose()
    } catch (e) {
      if (e instanceof AppError && e.detail) setErr(e.detail as Record<string, string>)
      toast(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const del = async () => {
    if (!v.id || !confirm('この枠を削除しますか？（作成済みの予定は消えません）')) return
    setBusy(true)
    try {
      await repo().call('deleteTemplate', v.id)
      await afterChange()
      toast('枠を削除しました')
      onClose()
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={!!slot} onClose={onClose} label="週間予定の枠" header={<h2 className="text-[19px] font-bold">{v.id ? '枠を編集' : '枠を追加'}</h2>} footer={<div className="flex gap-2">{v.id && <Button variant="danger" size="lg" icon={<Trash2 size={17} />} onClick={() => void del()} disabled={busy}>削除</Button>}<Button size="lg" className="flex-1" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
      <div className="flex flex-col gap-4 pt-1">
        <Field label="曜日">
          <div className="grid grid-cols-7 gap-1.5">
            {WEEK_ORDER.map((w) => (
              <button key={w} type="button" aria-pressed={v.weekday === w} onClick={() => setV({ ...v, weekday: w })} className={cx('press h-11 cursor-pointer rounded-[12px] text-[15px] font-bold', v.weekday === w ? 'bg-accent text-white' : 'bg-sunken')}>
                {WD[w]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="利用者" htmlFor="t-client" error={err.clientId}>
          <select
            id="t-client"
            value={v.clientId ?? ''}
            onChange={(e) => {
              const c = meta.clients.find((x) => x.id === e.target.value)
              setV({ ...v, clientId: e.target.value, ...(c ? { duration: c.defaultDuration, kind: c.defaultKind, staffId: c.defaultStaffId, start: c.defaultStart ?? v.start } : {}) })
              setErr({})
            }}
            className={inputCls(err.clientId)}
          >
            <option value="">選んでください</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始時刻" htmlFor="t-start" error={err.start}>
            <input id="t-start" type="time" step={300} value={v.start != null ? hhmm(v.start) : ''} onChange={(e) => setV({ ...v, start: parseHm(e.target.value) ?? undefined })} className={cx(inputCls(err.start), 'num font-bold')} />
          </Field>
          <Field label="所要時間（分）" htmlFor="t-dur" error={err.duration}>
            <input id="t-dur" type="number" min={5} max={480} step={5} value={v.duration ?? ''} onChange={(e) => setV({ ...v, duration: Number(e.target.value) })} className={cx(inputCls(err.duration), 'num font-bold')} />
          </Field>
        </div>
        <Field label="担当者">
          <Segmented label="担当者" value={v.staffId ?? ''} onChange={(s) => setV({ ...v, staffId: s })} options={meta.staff.map((s) => ({ value: s.id, label: <><StaffMark staff={s} size={18} /><span className="truncate">{s.name}</span></> }))} />
        </Field>
        <Field label="訪問内容">
          <Segmented label="訪問内容" value={v.kind ?? 'nursing'} onChange={(k: Kind) => setV({ ...v, kind: k })} options={(['nursing', 'rehab', 'other'] as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        </Field>
        <Field label="メモ（任意）" htmlFor="t-memo">
          <input id="t-memo" value={v.memo ?? ''} onChange={(e) => setV({ ...v, memo: e.target.value })} className={inputCls()} />
        </Field>
      </div>
    </Sheet>
  )
}

function ApplySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nextMon = addDays(mondayOf(todayJST()), 7)
  const [from, setFrom] = useState(nextMon)
  const [to, setTo] = useState(addDays(nextMon, 27))
  const [plan, setPlan] = useState<TemplatePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = (id: string) => clientById(id)?.name ?? ''
  const check = async () => {
    setBusy(true)
    setError('')
    try {
      setPlan(await repo().call('planTemplate', from, to))
    } catch (e) {
      setError(errMessage(e))
      setPlan(null)
    } finally {
      setBusy(false)
    }
  }
  const apply = async (mode: 'strict' | 'all' | 'skipConflicts') => {
    setBusy(true)
    setError('')
    try {
      const r = await repo().call('applyTemplate', from, to, mode)
      await afterChange([from])
      toast(`${r.created}件の予定を作成しました${r.skipped ? `（${r.skipped}件は作成せず）` : ''}`)
      setPlan(null)
      onClose()
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const nConf = plan?.conflicts.length ?? 0
  return (
    <Sheet
      open={open}
      onClose={() => { setPlan(null); onClose() }}
      label="週間予定から作成"
      header={<h2 className="text-[19px] font-bold">週間予定から予定を作成</h2>}
      footer={
        plan ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {nConf > 0 ? (
              <>
                <Button size="lg" className="flex-1" onClick={() => void apply('skipConflicts')} disabled={busy}>
                  重なる枠を除いて作成
                </Button>
                <Button variant="secondary" size="lg" className="flex-1" onClick={() => void apply('all')} disabled={busy}>
                  重なりも承知で全部作成
                </Button>
              </>
            ) : (
              <Button size="lg" className="flex-1" onClick={() => void apply('strict')} disabled={busy || !plan.create.length}>
                {busy ? '作成中…' : `${plan.create.length}件を作成`}
              </Button>
            )}
          </div>
        ) : (
          <Button size="lg" className="w-full" onClick={() => void check()} disabled={busy}>
            {busy ? '確認中…' : '作成する予定を確認'}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始日" htmlFor="a-from">
            <input id="a-from" type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPlan(null))} className={inputCls()} />
          </Field>
          <Field label="終了日（3か月まで）" htmlFor="a-to">
            <input id="a-to" type="date" value={to} onChange={(e) => (setTo(e.target.value), setPlan(null))} className={inputCls()} />
          </Field>
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-[14px] text-bad">
            {error}
          </p>
        )}
        <AnimatePresence>
          {plan && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat n={plan.create.length} label="作成する" />
                <Stat n={plan.skipped.length} label="既にあるので作らない" />
                <Stat n={nConf} label="担当者の重なり" warn={nConf > 0} />
              </div>
              {nConf > 0 && (
                <div className="rounded-[16px] bg-warn-soft p-3 ring-1 ring-warn/25" role="alert">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[14.5px] font-bold text-warn">
                    <AlertTriangle size={17} aria-hidden />
                    重なる予定があります（このままでは1件も保存しません）
                  </p>
                  <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto text-[13px]">
                    {plan.conflicts.map((c, i) => (
                      <li key={i}>
                        <span className="num font-bold">{fmtShort(c.date)}</span> {staffById(c.staffId)?.name}：<span className="num">{hm(c.a.start)}–{hm(c.a.end)}</span> {name(c.a.clientId)}さん と <span className="num">{hm(c.b.start)}–{hm(c.b.end)}</span> {name(c.b.clientId)}さん
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.skipped.length > 0 && (
                <details className="rounded-[14px] bg-sunken px-3 py-2 text-[13px]">
                  <summary className="cursor-pointer font-semibold">作らない予定（{plan.skipped.length}件）</summary>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {plan.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="num">{fmtShort(s.date)} {hm(s.start)}</span> {name(s.clientId)}さん：{s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  )
}

function Stat({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div className={cx('rounded-[14px] px-2 py-2.5', warn ? 'bg-warn-soft text-warn' : 'bg-sunken')}>
      <p className="num text-[24px] leading-7 font-bold">{n}</p>
      <p className="text-[11.5px] leading-tight font-semibold">{label}</p>
    </div>
  )
}
