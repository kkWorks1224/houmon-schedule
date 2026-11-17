// 予定カード（スマホ）と小さな予定表示（週表示・検索）
import { motion } from 'motion/react'
import { Check, CheckCircle2, Moon, PencilLine, Repeat, RotateCcw } from 'lucide-react'
import { hm } from '../../../shared/date'
import { STATUS_LABEL, type Occ } from '../../../shared/types'
import { cx, Flick, KindTag, StaffMark, StaffTag, toast } from '../../components/ui'
import { errMessage } from '../../lib/repo'
import { clientById, setOccStatus, staffById, useApp } from '../../store/app'
import { openEditor } from '../editor/state'

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
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold', o.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-black/[0.06] text-ink-2')}>
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

/** スマホの予定カード。右フリック＝完了、左フリック＝お休み（同じ操作は編集画面の「状態」でもできる） */
export function OccCard({ o, showStaff, index = 0 }: { o: Occ; showStaff?: boolean; index?: number }) {
  const name = useClientName()
  const staff = staffById(o.staffId)
  const done = o.status === 'done'
  const skipped = o.status === 'skipped'
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ type: 'spring', duration: 0.42, bounce: 0.12, delay: Math.min(index, 8) * 0.025 }} className="list-none">
      <Flick
        right={done ? { label: '予定に戻す', icon: <RotateCcw size={20} />, color: '#6e737c', run: () => void changeStatus(o, 'scheduled').catch(() => {}) } : { label: '完了', icon: <Check size={22} strokeWidth={3} />, color: '#1f8a52', run: () => void changeStatus(o, 'done').catch(() => {}) }}
        left={skipped ? { label: '予定に戻す', icon: <RotateCcw size={20} />, color: '#6e737c', run: () => void changeStatus(o, 'scheduled').catch(() => {}) } : { label: o.seriesId ? 'この回お休み' : 'お休み', icon: <Moon size={20} />, color: '#5b6270', run: () => void changeStatus(o, 'skipped').catch(() => {}) }}
      >
        <button
          type="button"
          onClick={() => openEditor({ mode: 'edit', occ: o })}
          className={cx('press flex w-full cursor-pointer items-stretch gap-3 rounded-[18px] bg-white p-3 pr-3.5 text-left shadow-[0_1px_2px_rgb(15_23_42/0.05)] ring-1 ring-line', skipped && 'skipped-stripes bg-[#fafafa]')}
          aria-label={`${hm(o.start)}から${hm(o.end)} ${name(o.clientId)}さん ${staff?.name ?? ''} ${STATUS_LABEL[o.status]}。押すと編集`}
        >
          <span className={cx('relative w-[54px] shrink-0 border-r border-line pr-2 text-right', (done || skipped) && 'opacity-55')}>
            <span className="num block text-[19px] leading-6 font-bold">{hm(o.start)}</span>
            <span className="num block text-[13px] text-ink-3">{hm(o.end)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={cx('truncate text-[16.5px] font-bold tracking-tight', skipped && 'text-ink-3 line-through decoration-ink-3/60', done && 'text-ink-2')}>{name(o.clientId)}</span>
              <KindTag kind={o.kind} />
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {showStaff && <StaffTag staff={staff} />}
              <span className="num text-[12.5px] text-ink-3">{o.duration}分</span>
              <RepeatBadge o={o} />
              <StatusBadge o={o} />
            </span>
            {o.memo && <span className="mt-1 block truncate text-[13px] text-ink-2">{o.memo}</span>}
          </span>
        </button>
      </Flick>
    </motion.li>
  )
}

/** 週表示・検索結果で使う小さな予定 */
export function OccChip({ o, withStaff }: { o: Occ; withStaff?: boolean }) {
  const name = useClientName()
  const staff = staffById(o.staffId)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        openEditor({ mode: 'edit', occ: o })
      }}
      className={cx('press hover-lift flex w-full cursor-pointer items-center gap-1.5 rounded-[10px] bg-white px-2 py-1.5 text-left text-[13px] ring-1 ring-line', o.status === 'skipped' && 'skipped-stripes text-ink-3', o.status === 'done' && 'text-ink-2')}
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
