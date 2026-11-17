import { MapLinks } from '../../components/MapLinks'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, Repeat, Search, Sparkles, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { addDays, fmtDate, fmtShort, hhmm, hm, mondayOf, parseHm, WD, WEEK_ORDER, weekday } from '../../../shared/date'
import type { FollowingPlan } from '../../../shared/service'
import { AppError, KIND_LABEL, STATUS_LABEL, type Client, type Conflict, type Kind, type RepeatDraft, type Series, type Status, type VisitDraft } from '../../../shared/types'
import { Button, cx, Field, finePointer, inputCls, KindTag, Segmented, Sheet, StaffMark, StaffTag, toast } from '../../components/ui'
import { errMessage } from '../../lib/repo'
import { afterChange, clientById, repo, staffById, useApp } from '../../store/app'
import { changeStatus } from '../schedule/occ'
import { recentClients, suggestStart } from '../schedule/Schedule'
import { closeEditor, useEditor, type EditorInit } from './state'

type Step = 'client' | 'form' | 'scope' | 'following'
type SaveState = 'idle' | 'saving' | 'saved'
const DURATIONS = [30, 40, 45, 60, 90]

export function Editor() {
  const { init, seq } = useEditor()
  return (
    <Sheet open={!!init} onClose={closeEditor} label={init?.mode === 'edit' ? '予定を編集' : '予定を追加'} header={<div id="editor-header-slot" />} wide>
      {init && <EditorBody key={seq} init={init} />}
    </Sheet>
  )
}

/** シートのヘッダー位置に見出しを出す（Sheet の外側から描画するため） */
function Header({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => setEl(document.getElementById('editor-header-slot')), [])
  if (!el) return null
  return <PortalLite el={el}>{children}</PortalLite>
}
const PortalLite = ({ el, children }: { el: HTMLElement; children: ReactNode }) => createPortal(children, el)

function EditorBody({ init }: { init: EditorInit }) {
  const meta = useApp((s) => s.meta)
  const weeks = useApp((s) => s.weeks)
  const editOcc = init.mode === 'edit' ? init.occ : null
  const series: Series | null = editOcc?.seriesId ? (meta.series.find((s) => s.id === editOcc.seriesId) ?? null) : null

  const initialDraft = (): VisitDraft => {
    if (editOcc) return { clientId: editOcc.clientId, date: editOcc.date, start: editOcc.start, duration: editOcc.duration, staffId: editOcc.staffId, kind: editOcc.kind, memo: editOcc.memo }
    const i = init as Extract<EditorInit, { mode: 'new' }>
    const c = i.clientId ? clientById(i.clientId) : undefined
    const staffId = i.staffId ?? c?.defaultStaffId ?? meta.staff[0]?.id ?? ''
    return { clientId: c?.id ?? '', date: i.date, start: i.start ?? (c ? suggestStart(weeks[mondayOf(i.date)] ?? [], staffId, c, i.date) : 9 * 60), duration: c?.defaultDuration ?? 60, staffId, kind: c?.defaultKind ?? 'nursing', memo: '' }
  }
  const [draft, setDraft] = useState<VisitDraft>(initialDraft)
  const fixed = useRef({ start: init.mode === 'new' && init.start != null, staff: init.mode === 'new' && init.staffId != null })
  const [step, setStep] = useState<Step>(init.mode === 'new' && !init.clientId ? 'client' : 'form')
  const [repeatOn, setRepeatOn] = useState(!!series || (init.mode === 'new' && !!init.repeat))
  const [repeat, setRepeat] = useState<RepeatDraft>(() => (series ? { weekdays: series.weekdays, interval: series.interval, startDate: series.startDate, endDate: series.endDate } : { weekdays: [weekday(draft.date)], interval: 1, startDate: draft.date, endDate: null }))
  const [status, setStatus] = useState<Status>(editOcc?.status ?? 'scheduled')
  // 状態を変えると更新時刻が進むので、保存時の競合確認に使う値も追従させる
  const [base, setBase] = useState<{ visitId: string | null; updatedAt: number }>({ visitId: editOcc?.visitId ?? null, updatedAt: editOcc?.updatedAt ?? 0 })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [preview, setPreview] = useState<{ next: string[]; checkedUntil: string; count: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const [save, setSave] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [justSaved, setJustSaved] = useState<string>('')
  const [keep, setKeep] = useState(true)
  const [plan, setPlan] = useState<FollowingPlan | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const repeatChanged = !!series && (series.weekdays.join() !== [...repeat.weekdays].sort().join() || series.interval !== repeat.interval || series.endDate !== repeat.endDate)
  const isNewSeries = init.mode === 'new' && repeatOn
  const client = clientById(draft.clientId)

  const patch = (p: Partial<VisitDraft>) => {
    setDraft((d) => ({ ...d, ...p }))
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in p))))
    setSaveError('')
  }

  // 段階が変わったらシートの先頭から見せる
  useEffect(() => {
    document.querySelector('[role="dialog"] .overflow-y-auto')?.scrollTo({ top: 0 })
  }, [step])

  // 利用者を選んだら開始時刻へフォーカス（そのまま Enter で保存できる）
  const focusStart = useRef(false)

  const pickClient = (c: Client) => {
    const staffId = fixed.current.staff ? draft.staffId : c.defaultStaffId
    const start = fixed.current.start ? draft.start : suggestStart(weeks[mondayOf(draft.date)] ?? [], staffId, c, draft.date)
    patch({ clientId: c.id, staffId, start, duration: c.defaultDuration, kind: c.defaultKind })
    focusStart.current = true
    setStep('form')
  }

  // ---- 入力中に重複を確認（保存前に知らせる） ----
  useEffect(() => {
    if (step !== 'form' || !draft.clientId || !parseOk(draft)) return
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        if (isNewSeries) {
          const p = await repo().call('previewSeries', draft, repeat)
          setConflicts(p.conflicts)
          setPreview(p)
        } else {
          setConflicts(await repo().call('checkVisit', draft, editOcc?.key))
          setPreview(null)
        }
      } catch {
        setConflicts([])
        setPreview(null)
      } finally {
        setChecking(false)
      }
    }, 220)
    return () => clearTimeout(t)
  }, [draft, repeat, isNewSeries, step, editOcc?.key])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!draft.clientId) e.clientId = '利用者を選んでください'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) e.date = '日付を入力してください'
    if (!Number.isInteger(draft.start) || draft.start < 0) e.start = '開始時刻を入力してください'
    if (!Number.isInteger(draft.duration) || draft.duration < 5 || draft.duration > 480) e.duration = '所要時間は5〜480分で入力してください'
    else if (draft.start + draft.duration > 24 * 60) e.duration = '終了時刻が24:00を超えています'
    if (repeatOn && (init.mode === 'new' || repeatChanged)) {
      if (!repeat.weekdays.length) e.weekdays = '曜日を1つ以上選んでください'
      if (repeat.endDate && repeat.endDate < (init.mode === 'new' ? repeat.startDate : draft.date)) e.endDate = '終了日は開始日以降にしてください'
    }
    setErrors(e)
    const first = Object.keys(e)[0]
    if (first) setTimeout(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus(), 0)
    return !first
  }

  const fail = (e: unknown) => {
    setSave('idle')
    if (e instanceof AppError) {
      if (e.code === 'invalid' && e.detail && typeof e.detail === 'object') setErrors(e.detail as Record<string, string>)
      if (e.code === 'conflict' && Array.isArray(e.detail)) setConflicts(e.detail as Conflict[])
    }
    setSaveError(errMessage(e))
  }

  const finish = async (msg: string, cont: boolean, dates: string[]) => {
    setSave('saved')
    await afterChange(dates)
    if (cont) {
      // 続けて追加：日付と担当者は残し、開始時刻は今の予定の終了時刻に
      setJustSaved(msg)
      setDraft((d) => ({ ...d, clientId: '', start: d.start + d.duration, memo: '' }))
      fixed.current = { start: true, staff: true }
      setConflicts([])
      setPreview(null)
      setRepeatOn(false)
      setStep('client')
      setTimeout(() => setSave('idle'), 400)
    } else {
      toast(msg)
      setTimeout(closeEditor, 380)
    }
  }

  const label = () => `${client?.name ?? ''}さん ${fmtShort(draft.date)} ${hm(draft.start)}–${hm(draft.start + draft.duration)}`
  const allow = conflicts.length > 0

  const submit = async (cont = false) => {
    if (save !== 'idle') return
    if (!validate()) return
    if (series && step === 'form') {
      setStep('scope')
      return
    }
    setSave('saving')
    setSaveError('')
    try {
      if (init.mode === 'new') {
        if (repeatOn) {
          await repo().call('createSeries', draft, { ...repeat, startDate: repeat.startDate || draft.date }, allow)
          await finish(`定期訪問を登録しました：${client?.name}さん`, cont, [repeat.startDate])
        } else {
          await repo().call('createVisit', draft, allow)
          await finish(`保存しました：${label()}`, cont, [draft.date])
        }
      } else if (editOcc && !editOcc.seriesId) {
        await repo().call('updateVisit', editOcc.visitId!, draft, base.updatedAt, allow)
        await finish(`保存しました：${label()}`, false, [draft.date, editOcc.date])
      }
    } catch (e) {
      fail(e)
    }
  }

  const saveOne = async () => {
    if (!editOcc?.seriesId) return
    setSave('saving')
    setSaveError('')
    try {
      // この回の重複は保存直前にもう一度確認
      const c = await repo().call('checkVisit', draft, editOcc.key)
      if (c.length && !conflicts.length) {
        setConflicts(c)
        setSave('idle')
        setStep('form')
        setSaveError('重なる予定があります。内容を確認してください')
        return
      }
      await repo().call('editOne', editOcc.seriesId, editOcc.occDate!, draft, c.length > 0, base.visitId ? base.updatedAt : null)
      await finish(`この回だけ変更しました：${label()}`, false, [draft.date, editOcc.date])
    } catch (e) {
      fail(e)
    }
  }

  const followingArgs = () => [editOcc!.seriesId!, editOcc!.occDate!, draft, { weekdays: repeat.weekdays, interval: repeat.interval, endDate: repeat.endDate }] as const
  const openFollowing = async (k = keep) => {
    setSave('saving')
    setSaveError('')
    try {
      const [sid, occ, d, r] = followingArgs()
      setPlan(await repo().call('previewFollowing', sid, occ, d, r, k))
      setStep('following')
    } catch (e) {
      setStep('form')
      fail(e)
      return
    }
    setSave('idle')
  }
  const saveFollowing = async () => {
    if (!plan) return
    setSave('saving')
    try {
      const [sid, occ, d, r] = followingArgs()
      await repo().call('editFollowing', sid, occ, d, r, keep, series?.updatedAt ?? null, plan.conflicts.length > 0)
      await finish(`${fmtShort(plan.from)}以降の定期訪問を変更しました`, false, [plan.from, editOcc!.date])
    } catch (e) {
      fail(e)
    }
  }

  const onStatus = async (s: Status) => {
    if (!editOcc) return
    const prev = status
    setStatus(s)
    try {
      const v = await changeStatus({ ...editOcc, visitId: base.visitId, status: prev }, s)
      setBase({ visitId: v.id, updatedAt: v.updatedAt })
    } catch {
      setStatus(prev)
    }
  }

  const removeOrRevert = async () => {
    if (!editOcc?.visitId) return
    const isException = !!editOcc.seriesId
    if (!confirm(isException ? 'この回の変更を取り消して、定期訪問の設定に戻しますか？' : 'この予定を削除しますか？（元に戻せません）')) return
    setSave('saving')
    try {
      await repo().call('deleteVisit', editOcc.visitId)
      await finish(isException ? '定期訪問の設定に戻しました' : '予定を削除しました', false, [editOcc.date])
    } catch (e) {
      fail(e)
    }
  }

  const endSeries = async () => {
    if (!editOcc?.seriesId) return
    if (!confirm(`${fmtShort(editOcc.occDate!)}以降の定期訪問を終了しますか？\n完了済みの回は記録として残ります。`)) return
    setSave('saving')
    try {
      await repo().call('cancel', editOcc.seriesId, editOcc.occDate!, 'following')
      await finish(`${fmtShort(editOcc.occDate!)}以降の定期訪問を終了しました`, false, [editOcc.date])
    } catch (e) {
      fail(e)
    }
  }

  // ---- 見出し ----
  const title = init.mode === 'new' ? (repeatOn ? '定期訪問を登録' : '予定を追加') : series ? '定期訪問の回を編集' : '予定を編集'

  return (
    <>
      <Header>
        <div className="flex items-center gap-1">
          {(step === 'scope' || step === 'following') && (
            <button type="button" onClick={() => setStep(step === 'following' ? 'scope' : 'form')} className="press -ml-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-black/5" aria-label="戻る">
              <ArrowLeft size={20} />
            </button>
          )}
          <h2 className="text-[19px] font-bold tracking-tight">{step === 'client' ? '利用者を選ぶ' : step === 'scope' ? '変更の範囲' : step === 'following' ? 'この回以降の変更を確認' : title}</h2>
        </div>
        {step === 'form' && client && (
          <p className="mt-0.5 truncate text-[13px] text-ink-3">
            {editOcc ? `${fmtDate(editOcc.occDate ?? editOcc.date)}の回` : '利用者の標準設定を入力済み'}
            {series && `・${seriesText(series)}`}
          </p>
        )}
      </Header>

      <AnimatePresence>
        {justSaved && step === 'client' && (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mb-3 flex items-center gap-2 rounded-2xl bg-ok-soft px-3.5 py-2.5 text-[14px] font-medium text-ok">
            <Check size={17} strokeWidth={3} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{justSaved}</span>
            <span className="shrink-0 text-[12.5px] text-ok/80">続けて次の予定へ</span>
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} initial={{ opacity: 0, x: step === 'client' ? -16 : 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ type: 'spring', duration: 0.32, bounce: 0.05 }}>
          {step === 'client' && <ClientPicker onPick={pickClient} staffHint={draft.staffId} onAi={(p) => applyParsed(p)} onCancel={closeEditor} context={`${fmtShort(draft.date)} ${hm(draft.start)}〜・${staffById(draft.staffId)?.name ?? ''}`} />}
          {step === 'form' && (
            <form
              ref={formRef}
              onSubmit={(e) => {
                e.preventDefault()
                void submit(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void submit(e.shiftKey)
                }
              }}
              noValidate
              className="flex flex-col gap-5 pt-1"
            >
              {init.mode === 'new' && <AiBox onParsed={applyParsed} />}
              {/* 利用者 */}
              <Field label="利用者" error={errors.clientId}>
                <button type="button" data-field="clientId" onClick={() => !series && setStep('client')} disabled={!!series} className={cx('press flex min-h-[56px] w-full cursor-pointer items-center gap-3 rounded-[14px] bg-sunken px-3.5 text-left disabled:cursor-default', errors.clientId && 'ring-1 ring-bad/70')} aria-label={client ? `利用者：${client.name}（押して変更）` : '利用者を選ぶ'}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-bold">{client ? `${client.name}さん` : '選んでください'}</span>
                    {client?.memo && <span className="block truncate text-[13px] text-ink-2">{client.memo}</span>}
                  </span>
                  {!series && <span className="shrink-0 text-[14px] font-semibold text-accent">変更</span>}
                </button>
                {client?.address?.trim() && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="min-w-0 flex-1 text-[13.5px] text-ink-2">{client.address}</span>
                    <MapLinks address={client.address} name={client.name} size="sm" />
                  </div>
                )}
              </Field>

              {/* 日付・時刻 */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="日付" htmlFor="f-date" error={errors.date} className="col-span-2 sm:col-span-1">
                  <input id="f-date" data-field="date" type="date" value={draft.date} onChange={(e) => {
                    const d = e.target.value
                    if (init.mode === 'new' && repeat.startDate === draft.date) setRepeat((r) => ({ ...r, startDate: d, weekdays: r.weekdays.length === 1 && r.weekdays[0] === weekday(draft.date) && d ? [weekday(d)] : r.weekdays }))
                    patch({ date: d })
                  }} className={inputCls(errors.date)} aria-invalid={!!errors.date} disabled={!!series && repeatChanged} />
                </Field>
                <Field label="開始時刻" htmlFor="f-start" error={errors.start} className="col-span-2 sm:col-span-1">
                  <div className="flex gap-1.5">
                    <input id="f-start" ref={(el) => { if (el && focusStart.current) { focusStart.current = false; if (finePointer()) el.focus({ preventScroll: true }) } }} data-field="start" type="time" step={300} value={Number.isFinite(draft.start) ? hhmm(draft.start) : ''} onChange={(e) => patch({ start: parseHm(e.target.value) ?? NaN })} className={cx(inputCls(errors.start), 'num min-w-0 flex-1 text-[18px] font-bold')} aria-invalid={!!errors.start} />
                    <Nudge label="15分早く" onClick={() => patch({ start: Math.max(0, draft.start - 15) })}>−15</Nudge>
                    <Nudge label="15分遅く" onClick={() => patch({ start: Math.min(23 * 60 + 45, draft.start + 15) })}>＋15</Nudge>
                  </div>
                </Field>
              </div>

              <Field label="所要時間" htmlFor="f-dur" error={errors.duration}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {DURATIONS.map((d) => (
                    <button key={d} type="button" onClick={() => patch({ duration: d })} aria-pressed={draft.duration === d} className={cx('press num h-11 min-w-[54px] cursor-pointer rounded-full px-3 text-[15px] font-bold', draft.duration === d ? 'bg-ink text-white' : 'bg-sunken text-ink')}>
                      {d}
                    </button>
                  ))}
                  <span className="flex items-center gap-1">
                    <input id="f-dur" data-field="duration" type="number" inputMode="numeric" min={5} max={480} step={5} value={Number.isFinite(draft.duration) ? draft.duration : ''} onChange={(e) => patch({ duration: e.target.value === '' ? NaN : Math.round(Number(e.target.value)) })} className={cx(inputCls(errors.duration), 'num w-[84px] text-center font-bold')} aria-label="所要時間（分）" aria-invalid={!!errors.duration} />
                    <span className="text-[14px] text-ink-2">分</span>
                  </span>
                </div>
              </Field>
              <div className="-mt-2 flex items-center gap-2 rounded-[14px] bg-accent-soft/60 px-3.5 py-2.5 text-[15px]" aria-live="polite">
                <span className="text-ink-2">時間</span>
                <span className="num text-[18px] font-bold">{Number.isFinite(draft.start) ? hm(draft.start) : '--:--'}</span>
                <span className="text-ink-3">→</span>
                <span className="num text-[18px] font-bold">{Number.isFinite(draft.start) && Number.isFinite(draft.duration) ? hm(draft.start + draft.duration) : '--:--'}</span>
                <span className="text-[13px] text-ink-3">（終了は自動計算）</span>
              </div>

              <Field label="担当者" error={errors.staffId}>
                <Segmented label="担当者" value={draft.staffId} onChange={(v) => { fixed.current.staff = true; patch({ staffId: v }) }} options={meta.staff.map((s) => ({ value: s.id, label: <><StaffMark staff={s} size={20} /><span className="truncate">{s.name}</span></> }))} />
              </Field>

              <Field label="訪問内容">
                <Segmented label="訪問内容" value={draft.kind} onChange={(v: Kind) => patch({ kind: v })} options={(['nursing', 'rehab', 'other'] as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
              </Field>

              {/* 繰り返し */}
              {(init.mode === 'new' || series) && (
                <RepeatPanel on={repeatOn} setOn={init.mode === 'new' ? setRepeatOn : undefined} repeat={repeat} setRepeat={(r) => { setRepeat(r); setErrors((e) => ({ ...e, weekdays: '', endDate: '' })) }} errors={errors} isEdit={!!series} preview={preview} occDate={editOcc?.occDate ?? null} />
              )}

              <Field label="メモ（任意）" htmlFor="f-memo" error={errors.memo}>
                <input id="f-memo" data-field="memo" value={draft.memo} maxLength={500} onChange={(e) => patch({ memo: e.target.value })} placeholder="例：玄関は裏口から" className={inputCls(errors.memo)} />
              </Field>

              <ConflictBox conflicts={conflicts} checking={checking} series={isNewSeries} until={preview?.checkedUntil} />

              {editOcc && (
                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  <Field label="状態（右フリック＝完了、左フリック＝お休みと同じ）">
                    <Segmented label="状態" value={status} onChange={(s: Status) => void onStatus(s)} options={(['scheduled', 'done', 'skipped'] as Status[]).map((s) => ({ value: s, label: s === 'skipped' && series ? 'この回お休み' : STATUS_LABEL[s] }))} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {editOcc.visitId && (
                      <Button variant={editOcc.seriesId ? 'secondary' : 'danger'} size="sm" onClick={() => void removeOrRevert()}>
                        {editOcc.seriesId ? 'この回の変更を取り消す' : '予定を削除'}
                      </Button>
                    )}
                    {series && (
                      <Button variant="danger" size="sm" onClick={() => void endSeries()}>
                        この回以降の定期を終了
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <button type="submit" hidden />
            </form>
          )}
          {step === 'scope' && (
            <ScopeChooser
              occDate={editOcc!.occDate!}
              repeatChanged={repeatChanged}
              busy={save !== 'idle'}
              onOne={() => void saveOne()}
              onFollowing={() => void openFollowing()}
            />
          )}
          {step === 'following' && plan && (
            <FollowingReview plan={plan} keep={keep} setKeep={(k) => { setKeep(k); void openFollowing(k) }} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* フッター：保存状態をボタンそのもので見せる */}
      {(step === 'form' || step === 'following') && (
        <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 mt-5 border-t border-line bg-white/90 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur-xl">
          <AnimatePresence>
            {saveError && (
              <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert" className="mb-2 flex items-start gap-2 overflow-hidden rounded-xl bg-bad-soft px-3 py-2 text-[14px] font-medium text-bad">
                <X size={16} className="mt-0.5 shrink-0" aria-hidden />
                保存できませんでした：{saveError}
              </motion.p>
            )}
          </AnimatePresence>
          <div className="flex gap-2">
            {step === 'form' && init.mode === 'new' && (
              <Button variant="secondary" size="lg" className="flex-1 px-3" onClick={() => void submit(true)} disabled={save !== 'idle'} title="Ctrl/⌘ + Shift + Enter">
                保存して続けて追加
              </Button>
            )}
            <SaveButton
              state={save}
              warn={allow && (step === 'form' ? !series : true) && (step !== 'following' || (plan?.conflicts.length ?? 0) > 0)}
              onClick={() => (step === 'following' ? void saveFollowing() : void submit(false))}
              label={step === 'following' ? (plan?.conflicts.length ? '重なりを承知で変更' : 'この内容で変更') : series ? '次へ' : allow ? '重なりを承知で保存' : '保存'}
            />
          </div>
          {step === 'form' && <p className="mt-2 hidden text-center text-[12px] text-ink-3 lg:block">{init.mode === 'new' ? 'Enter で保存／Ctrl・⌘ + Shift + Enter で保存して続けて追加／Esc で閉じる' : 'Enter で保存／Esc で閉じる'}</p>}
        </div>
      )}
    </>
  )

  function applyParsed(p: Partial<Record<string, unknown>>) {
    const c = typeof p.clientId === 'string' ? clientById(p.clientId) : undefined
    const next: Partial<VisitDraft> = {}
    if (c) Object.assign(next, { clientId: c.id, duration: c.defaultDuration, kind: c.defaultKind, staffId: c.defaultStaffId })
    if (typeof p.date === 'string') next.date = p.date
    if (typeof p.start === 'number') next.start = p.start
    if (typeof p.duration === 'number') next.duration = p.duration
    if (typeof p.staffId === 'string') next.staffId = p.staffId
    if (typeof p.kind === 'string') next.kind = p.kind as Kind
    if (typeof p.memo === 'string' && p.memo) next.memo = p.memo
    const d = { ...draft, ...next }
    if (next.start === undefined && c) d.start = suggestStart(weeks[mondayOf(d.date)] ?? [], d.staffId, c, d.date)
    setDraft(d)
    if (Array.isArray(p.weekdays) && p.weekdays.length) {
      setRepeatOn(true)
      setRepeat({ weekdays: p.weekdays as number[], interval: p.interval === 2 ? 2 : 1, startDate: firstMatch(d.date, p.weekdays as number[]), endDate: null })
    }
    setStep(d.clientId ? 'form' : 'client')
    const got = [c && '利用者', next.date && '日付', next.start !== undefined && '時刻', next.duration && '所要時間', next.staffId && '担当者', Array.isArray(p.weekdays) && p.weekdays.length && '繰り返し'].filter(Boolean)
    toast(got.length ? `読み取りました：${got.join('・')}` : '読み取れる項目がありませんでした', got.length ? 'info' : 'error')
  }
}

const parseOk = (d: VisitDraft) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Number.isFinite(d.start) && Number.isFinite(d.duration) && d.duration >= 5 && d.start + d.duration <= 1440
const firstMatch = (from: string, wds: number[]) => {
  let d = from
  for (let i = 0; i < 7 && !wds.includes(weekday(d)); i++) d = addDays(d, 1)
  return d
}
export const seriesText = (s: Pick<Series, 'weekdays' | 'interval'>) => `${s.interval === 2 ? '隔週' : '毎週'} ${WEEK_ORDER.filter((w) => s.weekdays.includes(w)).map((w) => WD[w]).join('・')}`

function Nudge({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="press num h-12 w-12 shrink-0 cursor-pointer rounded-[14px] bg-sunken text-[13px] font-bold text-ink-2 hover:bg-[#e4e7eb]">
      {children}
    </button>
  )
}

function SaveButton({ state, onClick, label, warn }: { state: SaveState; onClick: () => void; label: string; warn?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={state !== 'idle'}
      layout
      className={cx('press relative flex h-[52px] flex-1 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full px-5 text-[16px] font-bold text-white disabled:cursor-default', state === 'saved' ? 'bg-ok' : warn ? 'bg-warn' : 'bg-accent')}
      aria-live="polite"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={state + label} initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(3px)' }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }} className="flex items-center gap-2">
          {state === 'saving' ? (
            <>
              <Loader2 size={18} className="animate-spin" aria-hidden />
              保存中…
            </>
          ) : state === 'saved' ? (
            <>
              <Check size={19} strokeWidth={3} aria-hidden />
              保存しました
            </>
          ) : (
            <>
              {warn && <AlertTriangle size={17} aria-hidden />}
              {label}
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

// ---------- 利用者選択 ----------
function ClientPicker({ onPick, staffHint, onAi, onCancel, context }: { onPick: (c: Client) => void; staffHint: string; onAi: (p: Partial<Record<string, unknown>>) => void; onCancel: () => void; context: string }) {
  const clients = useApp((s) => s.meta.clients)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const norm = (s: string) => s.replace(/\s/g, '').toLowerCase()
  const recent = useMemo(() => recentClients(clients, staffHint).slice(0, 6), [clients, staffHint])
  const all = useMemo(() => clients.filter((c) => c.active).sort((a, b) => a.kana.localeCompare(b.kana, 'ja')), [clients])
  const hits = q ? all.filter((c) => norm(c.name).includes(norm(q)) || norm(c.kana).includes(norm(q))) : [...recent, ...all.filter((c) => !recent.includes(c))]
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const create = async () => {
    setCreating(true)
    try {
      const c = await repo().call('saveClient', { name: q.trim(), defaultStaffId: staffHint })
      await afterChange()
      toast(`利用者を登録しました：${c.name}さん（標準設定は利用者画面で変更できます）`)
      onPick(c)
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setCreating(false)
    }
  }

  const row = (c: Client, i: number) => (
    <button
      key={c.id}
      type="button"
      data-i={i}
      onClick={() => onPick(c)}
      onMouseMove={() => setActive(i)}
      role="option"
      aria-selected={active === i}
      className={cx('flex min-h-[58px] w-full cursor-pointer items-center gap-3 rounded-[14px] px-3 text-left transition-colors', active === i ? 'bg-accent-soft' : 'hover:bg-sunken')}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16.5px] font-bold">{c.name}さん</span>
        <span className="block truncate text-[12.5px] text-ink-3">{c.kana}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-2">
        <span className="num">{c.defaultStart != null ? `${hm(c.defaultStart)}・` : ''}{c.defaultDuration}分</span>
        <KindTag kind={c.defaultKind} />
        <StaffMark staff={staffById(c.defaultStaffId)} size={20} />
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />
    </button>
  )

  return (
    <div className="pt-1">
      <p className="mb-2 text-[13px] text-ink-3">{context}</p>
      <div className="relative mb-3">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          data-autofocus
          autoFocus={finePointer()}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, hits.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
            else if (e.key === 'Enter') {
              e.preventDefault()
              if (hits[active]) onPick(hits[active])
              else if (q.trim()) void create()
            } else if (e.key === 'Escape' && q) (e.preventDefault(), setQ(''))
          }}
          placeholder="名前・ふりがなで検索"
          aria-label="利用者を検索"
          role="combobox"
          aria-expanded
          aria-controls="client-list"
          aria-activedescendant={undefined}
          className={cx(inputCls(), 'pl-10')}
        />
      </div>
      <AiBox onParsed={onAi} compact />
      <div ref={listRef} id="client-list" role="listbox" aria-label="利用者" className="mt-2 flex flex-col gap-0.5">
        {!q && recent.length > 0 && <p className="px-3 pt-1 pb-1 text-[12.5px] font-semibold text-ink-3">最近・よく使う</p>}
        {hits.slice(0, q ? 50 : recent.length).map((c, i) => row(c, i))}
        {!q && <p className="px-3 pt-3 pb-1 text-[12.5px] font-semibold text-ink-3">すべての利用者（ふりがな順）</p>}
        {!q && hits.slice(recent.length).map((c, i) => row(c, i + recent.length))}
        {q && !hits.length && <p className="px-3 py-2 text-[14px] text-ink-3">「{q}」に一致する利用者はいません</p>}
        {q.trim() && (
          <button type="button" onClick={() => void create()} disabled={creating} className="press mt-2 flex h-12 cursor-pointer items-center gap-2 rounded-[14px] px-3 text-[15px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-50">
            <UserPlus size={18} aria-hidden />
            「{q.trim()}」を新しい利用者として登録
          </button>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          閉じる
        </Button>
      </div>
    </div>
  )
}

// ---------- 文章で入力（Workers AI／デモはルールで読み取り） ----------
function AiBox({ onParsed, compact }: { onParsed: (p: Partial<Record<string, unknown>>) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const kind = useApp((s) => s.repo?.kind)
  const run = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      onParsed((await repo().parse(text)) as unknown as Record<string, unknown>)
      setText('')
      setOpen(false)
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={cx('press flex cursor-pointer items-center gap-2 rounded-full text-[14px] font-semibold text-accent hover:bg-accent-soft/60', compact ? 'h-9 px-2' : 'h-10 self-start px-3 ring-1 ring-accent/25')}>
        <Sparkles size={16} aria-hidden />
        文章で入力
      </button>
    )
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-[16px] bg-accent-soft/50 p-3 ring-1 ring-accent/20">
      <label htmlFor="ai-text" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink">
        <Sparkles size={15} aria-hidden />
        文章で入力（{kind === 'api' ? 'Workers AI が読み取り' : 'デモ：この端末内で読み取り'}）
      </label>
      <div className="flex gap-2">
        <input
          id="ai-text"
          autoFocus={finePointer()}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) (e.preventDefault(), e.stopPropagation(), void run())
          }}
          maxLength={300}
          placeholder="例：青葉さん 毎週月・木 9時から60分 遠藤さん"
          className={cx(inputCls(), 'bg-white')}
        />
        <Button onClick={() => void run()} disabled={!text.trim() || busy} className="h-12 shrink-0">
          {busy ? <Loader2 size={18} className="animate-spin" aria-label="読み取り中" /> : '読み取る'}
        </Button>
      </div>
      <p className="mt-1.5 text-[12px] text-ink-3">読み取った内容は保存前に必ず確認してください。</p>
    </motion.div>
  )
}

// ---------- 繰り返し ----------
function RepeatPanel({ on, setOn, repeat, setRepeat, errors, isEdit, preview, occDate }: { on: boolean; setOn?: (v: boolean) => void; repeat: RepeatDraft; setRepeat: (r: RepeatDraft) => void; errors: Record<string, string>; isEdit: boolean; preview: { next: string[]; checkedUntil: string; count: number } | null; occDate: string | null }) {
  const toggleWd = (w: number) => setRepeat({ ...repeat, weekdays: repeat.weekdays.includes(w) ? repeat.weekdays.filter((x) => x !== w) : [...repeat.weekdays, w] })
  return (
    <div className="rounded-[18px] bg-sunken/70 p-3.5 ring-1 ring-line">
      {setOn ? (
        <label className="flex cursor-pointer items-center gap-3">
          <Repeat size={19} className="text-ink-2" aria-hidden />
          <span className="flex-1 text-[15.5px] font-bold">繰り返す（定期訪問）</span>
          <Switch on={on} onChange={setOn} label="繰り返す（定期訪問）" />
        </label>
      ) : (
        <p className="flex items-center gap-2 text-[15px] font-bold">
          <Repeat size={18} aria-hidden />
          定期訪問の設定
          <span className="text-[12.5px] font-medium text-ink-3">（変えると「この回以降」の変更になります）</span>
        </p>
      )}
      <AnimatePresence initial={false}>
        {on && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }} className="overflow-hidden">
            <div className="flex flex-col gap-4 pt-4">
              <Field label="曜日（複数選べます）" error={errors.weekdays}>
                <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="曜日" data-field="weekdays" tabIndex={-1}>
                  {WEEK_ORDER.map((w) => {
                    const sel = repeat.weekdays.includes(w)
                    return (
                      <button key={w} type="button" aria-pressed={sel} onClick={() => toggleWd(w)} className={cx('press h-11 cursor-pointer rounded-[12px] text-[15px] font-bold', sel ? 'bg-accent text-white shadow-[0_2px_8px_rgb(10_108_224/0.3)]' : 'bg-white text-ink ring-1 ring-line')}>
                        {WD[w]}
                        <span className="sr-only">曜日</span>
                      </button>
                    )
                  })}
                </div>
              </Field>
              <Segmented label="間隔" value={repeat.interval} onChange={(v: 1 | 2) => setRepeat({ ...repeat, interval: v })} options={[{ value: 1, label: '毎週' }, { value: 2, label: '隔週' }]} />
              <div className="grid grid-cols-2 gap-3">
                <Field label={isEdit ? '適用開始' : '開始日'} htmlFor="r-start">
                  {isEdit ? (
                    <p className="flex h-12 items-center text-[15px] font-semibold">{occDate ? `${fmtShort(occDate)}の回から` : ''}</p>
                  ) : (
                    <input id="r-start" type="date" value={repeat.startDate} onChange={(e) => setRepeat({ ...repeat, startDate: e.target.value })} className={inputCls()} />
                  )}
                </Field>
                <Field label="終了日（任意）" htmlFor="r-end" error={errors.endDate}>
                  <div className="relative">
                    <input id="r-end" data-field="endDate" type="date" value={repeat.endDate ?? ''} onChange={(e) => setRepeat({ ...repeat, endDate: e.target.value || null })} className={inputCls(errors.endDate)} />
                    {repeat.endDate && (
                      <button type="button" aria-label="終了日をなしにする" onClick={() => setRepeat({ ...repeat, endDate: null })} className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/5">
                        <X size={15} />
                      </button>
                    )}
                  </div>
                </Field>
              </div>
              {!isEdit && preview && (
                <div aria-live="polite">
                  <p className="mb-1.5 text-[13px] font-semibold text-ink-2">直近の予定（保存前の確認）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.next.map((d) => (
                      <motion.span key={d} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="num rounded-full bg-white px-2.5 py-1 text-[13px] font-semibold ring-1 ring-line">
                        {fmtShort(d)}
                      </motion.span>
                    ))}
                    {!preview.next.length && <span className="text-[13px] text-bad">この条件では予定が作られません</span>}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cx('relative h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full transition-colors duration-200', on ? 'bg-ok' : 'bg-black/15')}>
      <motion.span className="absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2)]" animate={{ x: on ? 20 : 0 }} transition={{ type: 'spring', duration: 0.3, bounce: 0.25 }} />
    </button>
  )
}

// ---------- 重複の表示 ----------
function ConflictBox({ conflicts, checking, series, until }: { conflicts: Conflict[]; checking: boolean; series: boolean; until?: string }) {
  const name = (id: string) => clientById(id)?.name ?? ''
  return (
    <div aria-live="polite">
      <AnimatePresence initial={false} mode="popLayout">
        {conflicts.length > 0 ? (
          <motion.div key="c" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-[16px] bg-warn-soft p-3.5 ring-1 ring-warn/25" role="alert">
            <p className="mb-2 flex items-center gap-2 text-[15px] font-bold text-warn">
              <AlertTriangle size={18} aria-hidden />
              担当者の予定が{conflicts.length}件重なっています
            </p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-[13.5px] text-ink">
              {conflicts.slice(0, 30).map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="num font-bold">{fmtShort(c.date)}</span>
                  <StaffTag staff={staffById(c.staffId)} />
                  <span>
                    <span className="num">{hm(c.a.start)}–{hm(c.a.end)}</span> {name(c.a.clientId)}さん と <span className="num">{hm(c.b.start)}–{hm(c.b.end)}</span> {name(c.b.clientId)}さん
                  </span>
                </li>
              ))}
              {conflicts.length > 30 && <li className="text-ink-3">ほか{conflicts.length - 30}件</li>}
            </ul>
            <p className="mt-2 text-[12.5px] text-ink-2">時刻や担当者を変えるか、承知のうえで保存してください（終了と次の開始が同じ時刻は重なりにしません）。</p>
          </motion.div>
        ) : (
          <motion.p key="ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-[13px] text-ink-3">
            {checking ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} className="text-ok" aria-hidden />}
            {checking ? '重なりを確認中…' : series ? `重なる予定はありません${until ? `（${fmtShort(until)}まで確認）` : ''}` : '重なる予定はありません'}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------- この回だけ／この回以降 ----------
function ScopeChooser({ occDate, repeatChanged, busy, onOne, onFollowing }: { occDate: string; repeatChanged: boolean; busy: boolean; onOne: () => void; onFollowing: () => void }) {
  const opt = (title: string, desc: string, onClick: () => void, disabled = false, auto = false) => (
    <button type="button" onClick={onClick} disabled={disabled || busy} data-autofocus={auto || undefined} className="press flex min-h-[72px] w-full cursor-pointer items-center gap-3 rounded-[18px] bg-white px-4 py-3 text-left ring-1 ring-line-strong hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-45">
      <span className="min-w-0 flex-1">
        <span className="block text-[16.5px] font-bold">{title}</span>
        <span className="block text-[13px] text-ink-2">{desc}</span>
      </span>
      {busy ? <Loader2 size={18} className="animate-spin text-ink-3" aria-hidden /> : <ChevronRight size={20} className="text-ink-3" aria-hidden />}
    </button>
  )
  return (
    <div className="flex flex-col gap-2.5 pt-1">
      <p className="mb-1 text-[14px] text-ink-2">{fmtDate(occDate)}の回の変更を、どこまで適用しますか？</p>
      {opt('この回だけ', repeatChanged ? '曜日・間隔・終了日を変えたときは選べません' : 'ほかの回は今のままです', onOne, repeatChanged, !repeatChanged)}
      {opt('この回以降', `${fmtShort(occDate)}以降の定期訪問をすべて変更します。保存前に内容を確認できます`, onFollowing, false, repeatChanged)}
    </div>
  )
}

function FollowingReview({ plan, keep, setKeep }: { plan: FollowingPlan; keep: boolean; setKeep: (k: boolean) => void }) {
  const result = { kept: '個別の変更を残す', detached: '単発の予定として残す', removed: '削除' } as const
  return (
    <div className="flex flex-col gap-4 pt-1">
      <p className="text-[14.5px] text-ink-2">
        <span className="font-bold text-ink">{fmtDate(plan.from)}</span>以降の定期訪問を変更します。{plan.inPlace ? '（最初の回からの変更なので、定期訪問全体が変わります）' : 'それより前の回は今のままです。'}
      </p>
      <div>
        <p className="mb-1.5 text-[13px] font-semibold text-ink-2">変更後の直近の予定</p>
        <div className="flex flex-wrap gap-1.5">
          {plan.next.map((d) => (
            <span key={d} className="num rounded-full bg-white px-2.5 py-1 text-[13px] font-semibold ring-1 ring-line">
              {fmtShort(d)}
            </span>
          ))}
        </div>
      </div>
      {plan.exceptions.length > 0 && (
        <div className="rounded-[16px] bg-sunken p-3.5">
          <p className="mb-2 text-[14.5px] font-bold">個別に変更済みの回が{plan.exceptions.length}件あります</p>
          <Segmented size="sm" label="個別の変更の扱い" value={keep ? 'keep' : 'drop'} onChange={(v) => setKeep(v === 'keep')} options={[{ value: 'keep', label: '個別の変更を残す' }, { value: 'drop', label: '新しい設定にそろえる' }]} />
          <ul className="mt-2.5 flex flex-col gap-1 text-[13.5px]">
            {plan.exceptions.map((e) => (
              <li key={e.occDate} className="flex flex-wrap items-center gap-x-2">
                <span className="num font-bold">{fmtShort(e.occDate)}</span>
                <span className="text-ink-2">
                  {e.status === 'skipped' ? 'お休み' : e.status === 'done' ? '完了' : `${e.date !== e.occDate ? `${fmtShort(e.date)} ` : ''}${hm(e.start)}・${staffById(e.staffId)?.name}`}
                </span>
                <span className={cx('rounded-full px-2 py-0.5 text-[12px] font-semibold', e.result === 'removed' ? 'bg-bad-soft text-bad' : 'bg-ok-soft text-ok')}>→ {result[e.result]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-3">完了済みの回は、どちらを選んでも記録として残ります。</p>
        </div>
      )}
      <ConflictBox conflicts={plan.conflicts} checking={false} series until={undefined} />
    </div>
  )
}

