// ドラッグで予定を動かす：すぐ画面に反映 → 保存。重なりがあれば確認し、失敗したら元に戻す。
// 定期訪問の回は「この回だけ」の変更（ほかの回とルールは変わらない）。
import { AlertTriangle } from 'lucide-react'
import { fmtShort, hm, mondayOf } from '../../../shared/date'
import type { Conflict, Occ, Visit, VisitDraft } from '../../../shared/types'
import { askConfirm } from '../../components/confirm'
import { StaffTag, toast } from '../../components/ui'
import { errMessage } from '../../lib/repo'
import { afterChange, clientById, repo, staffById, useApp } from '../../store/app'

export interface MoveTo {
  date?: string
  start?: number
  duration?: number
  staffId?: string
}

const draftOf = (o: Occ, to: MoveTo = {}): VisitDraft => ({
  clientId: o.clientId,
  date: to.date ?? o.date,
  start: to.start ?? o.start,
  duration: to.duration ?? o.duration,
  staffId: to.staffId ?? o.staffId,
  kind: o.kind,
  memo: o.memo,
})

/** 表示中の予定を書き換える（週をまたぐ移動にも対応） */
function patch(o: Occ, d: VisitDraft) {
  const from = mondayOf(o.date)
  const to = mondayOf(d.date)
  const moved: Occ = { ...o, date: d.date, start: d.start, duration: d.duration, end: d.start + d.duration, staffId: d.staffId, exception: !!o.seriesId || o.exception }
  useApp.setState((s) => {
    const weeks = { ...s.weeks }
    if (weeks[from]) weeks[from] = weeks[from].filter((x) => x.key !== o.key)
    if (weeks[to]) weeks[to] = [...weeks[to].filter((x) => x.key !== o.key), moved]
    return { weeks }
  })
}
function restore(o: Occ) {
  useApp.setState((s) => {
    const weeks = { ...s.weeks }
    for (const k of Object.keys(weeks)) weeks[k] = weeks[k].filter((x) => x.key !== o.key)
    const m = mondayOf(o.date)
    if (weeks[m]) weeks[m] = [...weeks[m], o]
    return { weeks }
  })
}

async function save(o: Occ, d: VisitDraft, base: number | null, allow: boolean): Promise<Visit> {
  if (o.seriesId && o.occDate) return repo().call('editOne', o.seriesId, o.occDate, d, allow, base)
  return repo().call('updateVisit', o.visitId!, d, base, allow)
}

const same = (o: Occ, d: VisitDraft) => o.date === d.date && o.start === d.start && o.duration === d.duration && o.staffId === d.staffId

export async function moveOcc(o: Occ, to: MoveTo): Promise<void> {
  const d = draftOf(o, to)
  if (same(o, d)) return
  const base = o.seriesId ? (o.visitId ? o.updatedAt : null) : o.updatedAt
  patch(o, d)
  let v: Visit
  try {
    try {
      v = await save(o, d, base, false)
    } catch (e) {
      if (!(e && typeof e === 'object' && 'code' in e && e.code === 'conflict' && Array.isArray((e as { detail?: unknown }).detail))) throw e
      const ok = await askConfirm({
        title: '予定が重なります',
        body: <ConflictList list={(e as unknown as { detail: Conflict[] }).detail} />,
        ok: '重なりを承知で移動',
        cancel: '元に戻す',
      })
      if (!ok) {
        restore(o)
        return
      }
      v = await save(o, d, base, true)
    }
  } catch (e) {
    restore(o)
    toast(errMessage(e), 'error')
    return
  }
  const name = clientById(o.clientId)?.name ?? ''
  const what = [o.date !== d.date && fmtShort(d.date), (o.start !== d.start || o.date !== d.date) && hm(d.start), o.staffId !== d.staffId && `${staffById(d.staffId)?.name ?? ''}の担当`, o.duration !== d.duration && `${d.duration}分`].filter(Boolean).join('・')
  toast(`${name}さんを${what}に変更しました${o.seriesId ? '（この回だけ）' : ''}`, 'ok', {
    label: '元に戻す',
    run: () => {
      const back = draftOf(o)
      const cur: Occ = { ...o, ...back, visitId: v.id, updatedAt: v.updatedAt }
      patch({ ...cur, date: d.date }, back)
      void save(cur, back, v.updatedAt, true)
        .then(() => afterChange([o.date, d.date]))
        .catch((e) => (toast(errMessage(e), 'error'), void afterChange([o.date, d.date])))
    },
  })
  void afterChange([o.date, d.date])
}

function ConflictList({ list }: { list: Conflict[] }) {
  const name = (id: string) => clientById(id)?.name ?? ''
  return (
    <div className="rounded-[16px] bg-warn-soft p-3.5 ring-1 ring-warn/25">
      <p className="mb-2 flex items-center gap-2 text-[15px] font-bold text-warn">
        <AlertTriangle size={18} aria-hidden />
        担当者の予定が{list.length}件重なっています
      </p>
      <ul className="flex flex-col gap-1 text-[14px]">
        {list.slice(0, 10).map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="num font-bold">{fmtShort(c.date)}</span>
            <StaffTag staff={staffById(c.staffId)} />
            <span>
              <span className="num">{hm(c.a.start)}–{hm(c.a.end)}</span> {name(c.a.clientId)}さん と <span className="num">{hm(c.b.start)}–{hm(c.b.end)}</span> {name(c.b.clientId)}さん
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
