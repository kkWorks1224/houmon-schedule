// 予定カード（スマホ）と小さな予定表示（週表示・検索）
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, Moon, PencilLine, Repeat, RotateCcw } from 'lucide-react'
import { hm } from '../../../shared/date'
import { STATUS_LABEL, type Occ } from '../../../shared/types'
import { cx, Flick, haptic, KindTag, staffTone, StaffMark, StaffTag, toast } from '../../components/ui'
import { errMessage } from '../../lib/repo'
import { clientById, setOccStatus, staffById, useApp } from '../../store/app'
import { RouteIcon } from '../../components/MapLinks'
import { openEditor } from '../editor/state'
import { moveOcc } from './move'

export function useClientName() {
  useApp((s) => s.meta.clients)
  return (id: string) => clientById(id)?.name ?? '（削除された利用者）'
}

export async function changeStatus(o: Occ, status: Occ['status']) {
  try {
    const v = await setOccStatus(o, status)
    const name = clientById(o.clientId)?.name ?? ''
    toast(status === 'done' ? `${name}さんを完了にしました` : status === 'skipped' ? `${name}さんをお休みにしました${o.seriesId ? '（この回だけ）' : ''}` : `${name}さんを予定に戻しました`, 'ok', {
      label: '元に戻す',
      run: () => void setOccStatus({ ...o, status, visitId: v.id }, o.status).catch((e) => toast(errMessage(e), 'error')),
    })
    return v
  } catch (e) {
    toast(errMessage(e), 'error')
    throw e
  }
}

export function StatusBadge({ o }: { o: Occ }) {
  if (o.status === 'scheduled') return null
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold', o.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-fill text-ink-2')}>
      {o.status === 'done' ? <CheckCircle2 size={13} aria-hidden /> : <Moon size={13} aria-hidden />}
      {STATUS_LABEL[o.status]}
    </span>
  )
}

export function RepeatBadge({ o }: { o: Occ }) {
  if (!o.seriesId) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-ink-3" title={o.exception ? '定期訪問（この回は変更あり）' : '定期訪問'}>
      {o.exception ? <PencilLine size={13} aria-hidden /> : <Repeat size={13} aria-hidden />}
      {o.exception ? '定期・変更あり' : '定期'}
    </span>
  )
}

/** 長押ししてから上下になぞると、15分単位で開始時刻を動かす（スマホ）。左右のフリックとは別の操作 */
const PX_PER_STEP = 22
function useNudge(o: Occ) {
  const [lift, setLift] = useState<{ dy: number; delta: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const st = useRef({ timer: 0, x0: 0, y0: 0, lifted: false, delta: 0, id: -1, suppress: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 持ち上げている間は画面のスクロールを止める
    const block = (e: TouchEvent) => st.current.lifted && e.cancelable && e.preventDefault()
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || o.status !== 'scheduled') return
    const s = st.current
    Object.assign(s, { x0: e.clientX, y0: e.clientY, lifted: false, delta: 0, id: e.pointerId, suppress: false })
    clearTimeout(s.timer)
    const cleanup = () => {
      clearTimeout(s.timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== s.id) return
      const dy = ev.clientY - s.y0
      if (!s.lifted) {
        if (Math.hypot(ev.clientX - s.x0, dy) > 8) cleanup()
        return
      }
      const delta = Math.max(-o.start, Math.min(Math.round(dy / PX_PER_STEP) * 15, 24 * 60 - o.end))
      if (delta !== s.delta) haptic(6)
      s.delta = delta
      setLift({ dy, delta })
    }
    const finish = (commit: boolean) => {
      const { lifted, delta } = s
      cleanup()
      s.lifted = false
      if (!lifted) return
      s.suppress = true
      setLift(null)
      if (commit && delta) void moveOcc(o, { start: o.start + delta })
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    s.timer = window.setTimeout(() => {
      s.lifted = true
      haptic(14)
      setLift({ dy: 0, delta: 0 })
    }, 420)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }
  const onClickCapture = (e: React.MouseEvent) => {
    if (!st.current.suppress) return
    st.current.suppress = false
    e.preventDefault()
    e.stopPropagation()
  }
  return { ref, lift, onPointerDown, onClickCapture }
}

/** スマホの予定カード。右フリック＝完了、左フリック＝お休み（同じ操作は編集画面の「状態」でもできる） */
export function OccCard({ o, showStaff, index = 0 }: { o: Occ; showStaff?: boolean; index?: number }) {
  const name = useClientName()
  const staff = staffById(o.staffId)
  const done = o.status === 'done'
  const skipped = o.status === 'skipped'
  const nudge = useNudge(o)
  const lift = nudge.lift
  const start = o.start + (lift?.delta ?? 0)
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ type: 'spring', duration: 0.42, bounce: 0.12, delay: Math.min(index, 8) * 0.025 }} className="list-none">
      <div
        ref={nudge.ref}
        onPointerDown={nudge.onPointerDown}
        onClickCapture={nudge.onClickCapture}
        onContextMenu={(e) => e.preventDefault()}
        className={cx('relative [-webkit-touch-callout:none] select-none', lift && 'z-30')}
        style={lift ? { transform: `translateY(${lift.dy}px) scale(1.03)`, transition: 'transform 60ms linear' } : { transition: 'transform 240ms cubic-bezier(0.23, 1, 0.32, 1)' }}
      >
      <span className="row-sep left-[84px]" aria-hidden />
      {lift && (
        <span className="num pointer-events-none absolute -top-3 right-3 z-10 rounded-full bg-accent px-2.5 py-1 text-[13px] font-bold text-white shadow-lift">
          {lift.delta === 0 ? '上下になぞって時刻を変更' : `${lift.delta > 0 ? '+' : '−'}${Math.abs(lift.delta)}分`}
        </span>
      )}
      <Flick
        className={cx(lift && 'rounded-[16px] shadow-lift ring-2 ring-accent')}
        right={done ? { label: '予定に戻す', icon: <RotateCcw size={20} />, color: '#8e8e93', run: () => void changeStatus(o, 'scheduled').catch(() => {}) } : { label: '完了', icon: <Check size={22} strokeWidth={3} />, color: '#34c759', run: () => void changeStatus(o, 'done').catch(() => {}) }}
        left={skipped ? { label: '予定に戻す', icon: <RotateCcw size={20} />, color: '#8e8e93', run: () => void changeStatus(o, 'scheduled').catch(() => {}) } : { label: o.seriesId ? 'この回お休み' : 'お休み', icon: <Moon size={20} />, color: '#5e5ce6', run: () => void changeStatus(o, 'skipped').catch(() => {}) }}
      >
        <button
          type="button"
          onClick={() => openEditor({ mode: 'edit', occ: o })}
          className={cx('row-press relative flex w-full cursor-pointer items-stretch gap-3 bg-white py-3 pr-4 pl-5 text-left before:absolute before:inset-y-3 before:left-2 before:w-[4px] before:rounded-full', skipped ? 'skipped-stripes bg-[#fafafa] before:bg-line-strong' : staffTone(staff).bar)}
          aria-label={`${hm(o.start)}から${hm(o.end)} ${name(o.clientId)}さん ${staff?.name ?? ''} ${STATUS_LABEL[o.status]}。押すと編集`}
        >
          <span className={cx('relative w-[52px] shrink-0 text-right', (done || skipped) && 'opacity-55')}>
            <span className={cx('num block text-[17px] leading-6 font-semibold', !!lift?.delta && 'text-accent')}>{hm(start)}</span>
            <span className={cx('num block text-[13px] text-ink-3', !!lift?.delta && 'text-accent')}>{hm(start + o.duration)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={cx('truncate text-[17px] leading-6 font-semibold', skipped && 'text-ink-3 line-through decoration-ink-3/60', done && 'text-ink-2')}>{name(o.clientId)}</span>
              <KindTag kind={o.kind} />
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {showStaff && <StaffTag staff={staff} />}
              <span className="num text-[13px] text-ink-3">{o.duration}分</span>
              <RepeatBadge o={o} />
              <StatusBadge o={o} />
            </span>
            {o.memo && <span className="mt-0.5 block truncate text-[15px] text-ink-3">{o.memo}</span>}
          </span>
          {!skipped && !done && clientById(o.clientId)?.address?.trim() && <span className="w-[62px] shrink-0" aria-hidden />}
        </button>
        {!skipped && !done && <RouteIcon address={clientById(o.clientId)?.address ?? ''} name={name(o.clientId)} className="absolute top-1/2 right-3 -translate-y-1/2" />}
      </Flick>
      </div>
    </motion.li>
  )
}

/** 週表示でドラッグ中の予定 */
export const weekDrag: { occ: Occ | null } = { occ: null }

/** 週表示・検索結果で使う小さな予定。movable のときは別の日・担当者の枠へドラッグできる（PC） */
export function OccChip({ o, withStaff, movable }: { o: Occ; withStaff?: boolean; movable?: boolean }) {
  const name = useClientName()
  const staff = staffById(o.staffId)
  return (
    <button
      type="button"
      draggable={movable}
      onDragStart={(e) => {
        weekDrag.occ = o
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', o.key)
      }}
      onDragEnd={() => (weekDrag.occ = null)}
      onClick={(e) => {
        e.stopPropagation()
        openEditor({ mode: 'edit', occ: o })
      }}
      className={cx('press hover-lift flex w-full items-center gap-1.5 rounded-[8px] bg-white px-2 py-1.5 text-left text-[13px] shadow-[0_0_0_0.5px_rgb(60_60_67/0.18)]', movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer', o.status === 'skipped' && 'skipped-stripes text-ink-3', o.status === 'done' && 'text-ink-2')}
      title={`${hm(o.start)}–${hm(o.end)} ${name(o.clientId)} ${staff?.name ?? ''} ${STATUS_LABEL[o.status]}`}
    >
      {withStaff && <StaffMark staff={staff} size={18} />}
      <span className="num shrink-0 font-bold">{hm(o.start)}</span>
      <span className={cx('min-w-0 flex-1 truncate font-semibold', o.status === 'skipped' && 'line-through')}>{name(o.clientId)}</span>
      {o.status === 'done' && <CheckCircle2 size={14} className="shrink-0 text-ok" aria-label="完了" />}
      {o.status === 'skipped' && <Moon size={13} className="shrink-0" aria-label="お休み" />}
      {o.seriesId && o.status === 'scheduled' && <Repeat size={12} className="shrink-0 text-ink-3" aria-label="定期" />}
    </button>
  )
}
