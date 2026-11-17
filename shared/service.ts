// 予定の業務ロジック。ブラウザ保存（デモ）でもサーバ（D1）でも同じコードが動く。
// 保存先の違いは DataSource に閉じ込め、変更は Op の配列として一度に（全部か無しか）適用する。

import { addDays, diffDays, isDate, mondayOf } from './date'
import { buildOccurrences, expandSeries, findConflicts, fromSeries, nextOccurrences, occKey, type Candidate } from './engine'
import { AppError, type Client, type Conflict, type Kind, type Occ, type Op, type RepeatDraft, type Series, type Staff, type Status, type TemplateSlot, type Visit, type VisitDraft } from './types'

export interface DataSource {
  seriesBetween(from: string, to: string): Promise<Series[]>
  /** date または occDate が期間内の行 */
  visitsBetween(from: string, to: string): Promise<Visit[]>
  getSeries(id: string): Promise<Series | null>
  getVisit(id: string): Promise<Visit | null>
  /** ある定期の、occDate が from 以降の例外 */
  overridesOf(seriesId: string, from: string): Promise<Visit[]>
  overrideAt(seriesId: string, occDate: string): Promise<Visit | null>
  listSeries(): Promise<Series[]>
  listClients(): Promise<Client[]>
  listStaff(): Promise<Staff[]>
  listTemplates(): Promise<TemplateSlot[]>
  apply(ops: Op[]): Promise<void>
}

/** 定期訪問の重複を確認する期間（無期限のルールでも、この先これだけは確認する） */
export const HORIZON_DAYS = 182
export const MAX_RANGE_DAYS = 92
const KINDS: Kind[] = ['nursing', 'rehab', 'other']

export interface FollowingPlan {
  from: string
  /** 個別に変更済みで、この変更の影響を受ける回 */
  exceptions: { occDate: string; date: string; start: number; staffId: string; status: Status; result: 'kept' | 'detached' | 'removed' }[]
  next: string[]
  conflicts: Conflict[]
  inPlace: boolean
}

export interface TemplatePlan {
  create: (Candidate & { slotId: string; kind: Kind; memo: string; duration: number })[]
  skipped: { date: string; slotId: string; clientId: string; start: number; reason: string }[]
  conflicts: Conflict[]
}

export class Service {
  constructor(
    private ds: DataSource,
    private now: () => number = () => Date.now(),
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  // ---------- 参照 ----------
  async range(from: string, to: string): Promise<Occ[]> {
    if (!isDate(from) || !isDate(to) || to < from || diffDays(to, from) > MAX_RANGE_DAYS) throw new AppError('invalid', '期間の指定が正しくありません')
    const [series, visits] = await Promise.all([this.ds.seriesBetween(from, to), this.ds.visitsBetween(from, to)])
    return buildOccurrences(series, visits, from, to)
  }

  async bootstrap() {
    const [staff, clients, series, templates] = await Promise.all([this.ds.listStaff(), this.ds.listClients(), this.ds.listSeries(), this.ds.listTemplates()])
    return { staff, clients, series, templates }
  }

  // ---------- 入力チェック ----------
  private async validate(d: VisitDraft) {
    const errs: Record<string, string> = {}
    const [staff, clients] = await Promise.all([this.ds.listStaff(), this.ds.listClients()])
    if (!clients.some((c) => c.id === d.clientId)) errs.clientId = '利用者を選んでください'
    if (!isDate(d.date)) errs.date = '日付を入力してください'
    if (!Number.isInteger(d.start) || d.start < 0 || d.start > 23 * 60 + 55) errs.start = '開始時刻を入力してください'
    if (!Number.isInteger(d.duration) || d.duration < 5 || d.duration > 480) errs.duration = '所要時間は5〜480分で入力してください'
    else if (d.start + d.duration > 24 * 60) errs.duration = '終了時刻が24:00を超えています'
    if (!staff.some((s) => s.id === d.staffId)) errs.staffId = '担当者を選んでください'
    if (!KINDS.includes(d.kind)) errs.kind = '訪問内容を選んでください'
    if (typeof d.memo !== 'string' || d.memo.length > 500) errs.memo = 'メモは500文字までです'
    if (Object.keys(errs).length) throw new AppError('invalid', Object.values(errs)[0], errs)
    return { clients }
  }

  private validateRepeat(r: RepeatDraft) {
    const errs: Record<string, string> = {}
    if (!Array.isArray(r.weekdays) || r.weekdays.length === 0 || r.weekdays.some((w) => !Number.isInteger(w) || w < 0 || w > 6)) errs.weekdays = '曜日を1つ以上選んでください'
    if (r.interval !== 1 && r.interval !== 2) errs.interval = '毎週か隔週を選んでください'
    if (!isDate(r.startDate)) errs.startDate = '開始日を入力してください'
    if (r.endDate !== null && (!isDate(r.endDate) || r.endDate < r.startDate)) errs.endDate = '終了日は開始日以降にしてください'
    if (Object.keys(errs).length) throw new AppError('invalid', Object.values(errs)[0], errs)
  }

  private touchClient(clients: Client[], id: string): Op[] {
    const c = clients.find((x) => x.id === id)
    return c ? [{ t: 'put', table: 'clients', row: { ...c, useCount: c.useCount + 1, lastUsedAt: this.now() } }] : []
  }

  private conflictError(conflicts: Conflict[]) {
    return new AppError('conflict', `担当者の予定が${conflicts.length}件重なっています`, conflicts)
  }

  // ---------- 単発の予定 ----------
  async checkVisit(d: VisitDraft, selfKey?: string): Promise<Conflict[]> {
    const existing = await this.range(d.date, d.date)
    return findConflicts([{ ...d, end: d.start + d.duration, key: selfKey }], existing)
  }

  async createVisit(d: VisitDraft, allowConflicts = false): Promise<Visit> {
    const { clients } = await this.validate(d)
    const conflicts = await this.checkVisit(d)
    if (conflicts.length && !allowConflicts) throw this.conflictError(conflicts)
    const t = this.now()
    const v: Visit = { id: this.newId(), ...d, memo: d.memo.trim(), status: 'scheduled', seriesId: null, occDate: null, templateId: null, createdAt: t, updatedAt: t }
    await this.ds.apply([{ t: 'put', table: 'visits', row: v }, ...this.touchClient(clients, d.clientId)])
    return v
  }

  async updateVisit(id: string, d: VisitDraft, baseUpdatedAt: number | null, allowConflicts = false): Promise<Visit> {
    const cur = await this.ds.getVisit(id)
    if (!cur) throw new AppError('not_found', 'この予定は削除されています')
    if (baseUpdatedAt !== null && cur.updatedAt !== baseUpdatedAt) throw new AppError('stale', 'ほかの端末で先に変更されました。表示を更新してから操作してください')
    await this.validate(d)
    const key = cur.seriesId && cur.occDate ? occKey(cur.seriesId, cur.occDate) : cur.id
    const conflicts = await this.checkVisit(d, key)
    if (conflicts.length && !allowConflicts) throw this.conflictError(conflicts)
    const v: Visit = { ...cur, ...d, memo: d.memo.trim(), updatedAt: Math.max(this.now(), cur.updatedAt + 1) }
    await this.ds.apply([{ t: 'put', table: 'visits', row: v }])
    return v
  }

  /** 単発は削除、定期の回の例外は「定期の設定に戻す」 */
  async deleteVisit(id: string): Promise<void> {
    const cur = await this.ds.getVisit(id)
    if (!cur) return
    await this.ds.apply([{ t: 'del', table: 'visits', id }])
  }

  /** フリックで状態を変える */
  async setStatus(ref: { visitId?: string | null; seriesId?: string | null; occDate?: string | null }, status: Status): Promise<Visit> {
    if (!['scheduled', 'done', 'skipped'].includes(status)) throw new AppError('invalid', '状態が正しくありません')
    const t = this.now()
    if (ref.visitId) {
      const cur = await this.ds.getVisit(ref.visitId)
      if (!cur) throw new AppError('not_found', 'この予定は削除されています')
      const v = { ...cur, status, updatedAt: Math.max(t, cur.updatedAt + 1) }
      await this.ds.apply([{ t: 'put', table: 'visits', row: v }])
      return v
    }
    if (!ref.seriesId || !ref.occDate) throw new AppError('invalid', '予定の指定が正しくありません')
    const s = await this.ds.getSeries(ref.seriesId)
    if (!s) throw new AppError('not_found', 'この定期訪問は削除されています')
    if (!expandSeries(s, ref.occDate, ref.occDate).length) throw new AppError('not_found', 'この回は定期訪問の対象外です')
    const ov = await this.ds.overrideAt(s.id, ref.occDate)
    const v = ov ? { ...ov, status, updatedAt: Math.max(t, ov.updatedAt + 1) } : this.overrideFrom(s, ref.occDate, { status })
    await this.ds.apply([{ t: 'put', table: 'visits', row: v }])
    return v
  }

  private overrideFrom(s: Series, occDate: string, patch: Partial<Visit>): Visit {
    const t = this.now()
    const base = fromSeries(s, occDate)
    return {
      id: this.newId(),
      date: occDate,
      start: base.start,
      duration: base.duration,
      staffId: base.staffId,
      clientId: base.clientId,
      kind: base.kind,
      memo: base.memo,
      status: 'scheduled',
      seriesId: s.id,
      occDate,
      templateId: null,
      createdAt: t,
      updatedAt: t,
      ...patch,
    }
  }

  // ---------- 定期訪問 ----------
  private horizonEnd(from: string, endDate: string | null) {
    const h = addDays(from, HORIZON_DAYS - 1)
    return endDate && endDate < h ? endDate : h
  }

  /** 期間が長くても MAX_RANGE_DAYS ごとに区切って既存の予定を読む */
  private async occsBetween(from: string, to: string): Promise<Occ[]> {
    const out: Occ[] = []
    for (let a = from; a <= to; a = addDays(a, MAX_RANGE_DAYS + 1)) {
      const b = addDays(a, MAX_RANGE_DAYS) < to ? addDays(a, MAX_RANGE_DAYS) : to
      out.push(...(await this.range(a, b)))
    }
    return out
  }

  private buildSeries(d: VisitDraft, r: RepeatDraft, base?: Series): Series {
    const t = this.now()
    const anchor = base && base.interval === 2 && r.interval === 2 ? base.anchor : mondayOf(r.startDate)
    return {
      id: base?.id ?? this.newId(),
      clientId: d.clientId,
      staffId: d.staffId,
      start: d.start,
      duration: d.duration,
      kind: d.kind,
      memo: d.memo.trim(),
      weekdays: [...new Set(r.weekdays)].sort(),
      interval: r.interval,
      startDate: r.startDate,
      endDate: r.endDate,
      anchor,
      createdAt: base?.createdAt ?? t,
      updatedAt: base ? Math.max(t, base.updatedAt + 1) : t,
    }
  }

  async previewSeries(d: VisitDraft, r: RepeatDraft) {
    await this.validate(d)
    this.validateRepeat(r)
    const s = this.buildSeries(d, r)
    const hi = this.horizonEnd(r.startDate, r.endDate)
    const dates = expandSeries(s, r.startDate, hi)
    const existing = await this.occsBetween(r.startDate, hi)
    const conflicts = findConflicts(dates.map((date) => ({ date, start: s.start, end: s.start + s.duration, staffId: s.staffId, clientId: s.clientId })), existing)
    return { next: nextOccurrences(s, r.startDate, 8), checkedUntil: hi, count: dates.length, conflicts }
  }

  async createSeries(d: VisitDraft, r: RepeatDraft, allowConflicts = false): Promise<Series> {
    const p = await this.previewSeries(d, r)
    const clients = await this.ds.listClients()
    if (p.count === 0) throw new AppError('invalid', '指定した期間に該当する曜日がありません', { weekdays: '指定した期間に該当する曜日がありません' })
    if (p.conflicts.length && !allowConflicts) throw this.conflictError(p.conflicts)
    const s = this.buildSeries(d, r)
    await this.ds.apply([{ t: 'put', table: 'series', row: s }, ...this.touchClient(clients, d.clientId)])
    return s
  }

  /** 定期の「この回だけ」変更 */
  async editOne(seriesId: string, occDate: string, d: VisitDraft, allowConflicts = false, baseUpdatedAt: number | null = null): Promise<Visit> {
    const s = await this.ds.getSeries(seriesId)
    if (!s) throw new AppError('not_found', 'この定期訪問は削除されています')
    await this.validate(d)
    if (d.clientId !== s.clientId) throw new AppError('invalid', '定期訪問の回は利用者を変更できません。単発の予定として追加してください', { clientId: '定期訪問の回は利用者を変更できません' })
    const ov = await this.ds.overrideAt(seriesId, occDate)
    if (!ov && !expandSeries(s, occDate, occDate).length) throw new AppError('not_found', 'この回は定期訪問の対象外です')
    if (ov && baseUpdatedAt !== null && ov.updatedAt !== baseUpdatedAt) throw new AppError('stale', 'ほかの端末で先に変更されました。表示を更新してから操作してください')
    const conflicts = await this.checkVisit(d, occKey(seriesId, occDate))
    if (conflicts.length && !allowConflicts) throw this.conflictError(conflicts)
    const v: Visit = ov ? { ...ov, ...d, memo: d.memo.trim(), updatedAt: Math.max(this.now(), ov.updatedAt + 1) } : this.overrideFrom(s, occDate, { ...d, memo: d.memo.trim() })
    await this.ds.apply([{ t: 'put', table: 'visits', row: v }])
    return v
  }

  /**
   * 「この回以降」の変更を組み立てる（保存はしない）。
   * keep=true：個別に変更した回を残す。新しいルールでも同じ日に回があればその回の例外として残し、無ければ単発の予定に切り替える。
   * keep=false：個別の変更を破棄して新しい設定にそろえる（完了済みの回だけは記録として残す）。
   */
  private async planFollowing(seriesId: string, from: string, d: VisitDraft, r: Omit<RepeatDraft, 'startDate'>, keep: boolean, baseUpdatedAt: number | null) {
    const s = await this.ds.getSeries(seriesId)
    if (!s) throw new AppError('not_found', 'この定期訪問は削除されています')
    if (baseUpdatedAt !== null && s.updatedAt !== baseUpdatedAt) throw new AppError('stale', 'ほかの端末で先に変更されました。表示を更新してから操作してください')
    if (!isDate(from)) throw new AppError('invalid', '適用開始日が正しくありません')
    if (s.endDate && from > s.endDate) throw new AppError('invalid', '適用開始日が定期訪問の終了日より後です')
    if (d.clientId !== s.clientId) throw new AppError('invalid', '定期訪問の利用者は変更できません', { clientId: '定期訪問の利用者は変更できません' })
    const start = from < s.startDate ? s.startDate : from
    const repeat: RepeatDraft = { ...r, startDate: start }
    await this.validate(d)
    this.validateRepeat(repeat)
    const inPlace = start === s.startDate
    const next = this.buildSeries(d, repeat, inPlace ? s : { ...s, id: this.newId(), createdAt: this.now() })
    if (!inPlace) next.updatedAt = this.now()
    const ops: Op[] = []
    if (!inPlace) {
      ops.push({ t: 'put', table: 'series', row: { ...s, endDate: addDays(start, -1), updatedAt: Math.max(this.now(), s.updatedAt + 1) } })
    }
    ops.push({ t: 'put', table: 'series', row: next })

    const exceptions: FollowingPlan['exceptions'] = []
    const overrides = await this.ds.overridesOf(s.id, start)
    for (const o of overrides) {
      const generated = expandSeries(next, o.occDate!, o.occDate!).length > 0
      let result: 'kept' | 'detached' | 'removed'
      if (keep || o.status === 'done') {
        if (generated) {
          result = 'kept'
          if (!inPlace) ops.push({ t: 'put', table: 'visits', row: { ...o, seriesId: next.id, updatedAt: this.now() } })
        } else if (o.status === 'skipped') {
          result = 'removed'
          ops.push({ t: 'del', table: 'visits', id: o.id })
        } else {
          result = 'detached'
          ops.push({ t: 'put', table: 'visits', row: { ...o, seriesId: null, occDate: null, updatedAt: this.now() } })
        }
      } else {
        result = 'removed'
        ops.push({ t: 'del', table: 'visits', id: o.id })
      }
      exceptions.push({ occDate: o.occDate!, date: o.date, start: o.start, staffId: o.staffId, status: o.status, result })
    }

    // 重複確認：古いルールの from 以降の回と例外は置き換わるので比較から外す
    const hi = this.horizonEnd(start, next.endDate)
    const existing = await this.occsBetween(start, hi)
    const keptOcc = new Set(exceptions.filter((e) => e.result === 'kept').map((e) => e.occDate))
    const cands: Candidate[] = expandSeries(next, start, hi)
      .filter((date) => !keptOcc.has(date))
      .map((date) => ({ date, start: next.start, end: next.start + next.duration, staffId: next.staffId, clientId: next.clientId }))
    const conflicts = findConflicts(cands, existing, (o) => o.seriesId === s.id && (o.occDate ?? o.date) >= start)
    const plan: FollowingPlan = { from: start, exceptions, next: nextOccurrences(next, start, 8), conflicts, inPlace }
    return { plan, ops }
  }

  async previewFollowing(seriesId: string, from: string, d: VisitDraft, r: Omit<RepeatDraft, 'startDate'>, keep: boolean) {
    return (await this.planFollowing(seriesId, from, d, r, keep, null)).plan
  }

  async editFollowing(seriesId: string, from: string, d: VisitDraft, r: Omit<RepeatDraft, 'startDate'>, keep: boolean, baseUpdatedAt: number | null, allowConflicts = false) {
    const { plan, ops } = await this.planFollowing(seriesId, from, d, r, keep, baseUpdatedAt)
    if (plan.conflicts.length && !allowConflicts) throw this.conflictError(plan.conflicts)
    await this.ds.apply(ops)
    return plan
  }

  /** お休み：この回だけ／この回以降（以降は定期を終了。完了済みの回は単発として残す） */
  async cancel(seriesId: string, occDate: string, scope: 'one' | 'following') {
    const s = await this.ds.getSeries(seriesId)
    if (!s) throw new AppError('not_found', 'この定期訪問は削除されています')
    if (scope === 'one') return this.setStatus({ seriesId, occDate }, 'skipped')
    const ops: Op[] = []
    for (const o of await this.ds.overridesOf(s.id, occDate)) {
      if (o.status === 'done') ops.push({ t: 'put', table: 'visits', row: { ...o, seriesId: null, occDate: null, updatedAt: this.now() } })
      else ops.push({ t: 'del', table: 'visits', id: o.id })
    }
    if (occDate <= s.startDate) {
      // 過去の例外（開始日より前に移した回など）も単発として残す
      for (const o of await this.ds.overridesOf(s.id, '0000-01-01')) {
        if (o.occDate! < occDate) ops.push({ t: 'put', table: 'visits', row: { ...o, seriesId: null, occDate: null, updatedAt: this.now() } })
      }
      ops.push({ t: 'del', table: 'series', id: s.id })
    } else ops.push({ t: 'put', table: 'series', row: { ...s, endDate: addDays(occDate, -1), updatedAt: Math.max(this.now(), s.updatedAt + 1) } })
    await this.ds.apply(ops)
    return null
  }

  // ---------- 利用者・担当者 ----------
  async saveClient(c: Partial<Client> & { name: string }): Promise<Client> {
    const staff = await this.ds.listStaff()
    const name = (c.name ?? '').trim()
    const errs: Record<string, string> = {}
    if (!name) errs.name = '氏名を入力してください'
    if (name.length > 40) errs.name = '氏名は40文字までです'
    const dur = Number(c.defaultDuration ?? 60)
    if (!Number.isInteger(dur) || dur < 5 || dur > 480) errs.defaultDuration = '標準の所要時間は5〜480分です'
    if (c.defaultStaffId && !staff.some((s) => s.id === c.defaultStaffId)) errs.defaultStaffId = '担当者が正しくありません'
    if (c.defaultStart != null && (!Number.isInteger(c.defaultStart) || c.defaultStart < 0 || c.defaultStart > 1435)) errs.defaultStart = '標準の開始時刻が正しくありません'
    if (Object.keys(errs).length) throw new AppError('invalid', Object.values(errs)[0], errs)
    const cur = c.id ? (await this.ds.listClients()).find((x) => x.id === c.id) : undefined
    const t = this.now()
    const row: Client = {
      id: cur?.id ?? this.newId(),
      name,
      kana: (c.kana ?? '').trim().slice(0, 60),
      defaultDuration: dur,
      defaultKind: KINDS.includes(c.defaultKind as Kind) ? (c.defaultKind as Kind) : 'nursing',
      defaultStaffId: c.defaultStaffId ?? staff[0].id,
      defaultStart: c.defaultStart ?? null,
      address: (c.address ?? '').trim().slice(0, 200),
      memo: (c.memo ?? '').trim().slice(0, 500),
      active: c.active ?? true,
      useCount: cur?.useCount ?? 0,
      lastUsedAt: cur?.lastUsedAt ?? 0,
      updatedAt: t,
    }
    await this.ds.apply([{ t: 'put', table: 'clients', row }])
    return row
  }

  async renameStaff(id: string, name: string, mark?: string): Promise<Staff> {
    const s = (await this.ds.listStaff()).find((x) => x.id === id)
    if (!s) throw new AppError('not_found', '担当者が見つかりません')
    const n = name.trim()
    if (!n || n.length > 20) throw new AppError('invalid', '表示名は1〜20文字で入力してください', { name: '表示名は1〜20文字で入力してください' })
    const row = { ...s, name: n, mark: (mark ?? '').trim().slice(0, 1) || [...n][0] }
    await this.ds.apply([{ t: 'put', table: 'staff', row }])
    return row
  }

  // ---------- 基本の週間予定 ----------
  async saveTemplate(slot: Omit<TemplateSlot, 'id' | 'updatedAt'> & { id?: string }): Promise<TemplateSlot> {
    await this.validate({ clientId: slot.clientId, date: '2026-01-05', start: slot.start, duration: slot.duration, staffId: slot.staffId, kind: slot.kind, memo: slot.memo })
    if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6) throw new AppError('invalid', '曜日を選んでください', { weekday: '曜日を選んでください' })
    const row: TemplateSlot = { ...slot, id: slot.id ?? this.newId(), memo: slot.memo.trim(), updatedAt: this.now() }
    await this.ds.apply([{ t: 'put', table: 'templates', row }])
    return row
  }

  async deleteTemplate(id: string) {
    await this.ds.apply([{ t: 'del', table: 'templates', id }])
  }

  /**
   * 週間予定から期間の予定を作る計画。
   * 同じ利用者の予定（定期の回・お休みの回・前回作成分を含む）がその日にすでにある枠は作らない＝二重登録しない。
   */
  async planTemplate(from: string, to: string, slotIds?: string[]): Promise<TemplatePlan> {
    if (!isDate(from) || !isDate(to) || to < from) throw new AppError('invalid', '期間を正しく入力してください', { from: '期間を正しく入力してください' })
    if (diffDays(to, from) > MAX_RANGE_DAYS) throw new AppError('invalid', '一度に作成できるのは3か月までです', { to: '一度に作成できるのは3か月までです' })
    const slots = (await this.ds.listTemplates()).filter((s) => !slotIds || slotIds.includes(s.id))
    const existing = await this.range(from, to)
    const sameClient = new Map<string, Occ[]>()
    for (const o of existing) {
      const k = `${o.date}|${o.clientId}`
      sameClient.set(k, [...(sameClient.get(k) ?? []), o])
    }
    const plan: TemplatePlan = { create: [], skipped: [], conflicts: [] }
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
      for (const s of slots) {
        if (s.weekday !== wd) continue
        const dup = (sameClient.get(`${d}|${s.clientId}`) ?? [])[0]
        if (dup) {
          plan.skipped.push({ date: d, slotId: s.id, clientId: s.clientId, start: s.start, reason: dup.status === 'skipped' ? 'お休みの回があるため' : dup.seriesId ? '定期訪問の予定があるため' : '同じ利用者の予定があるため' })
          continue
        }
        plan.create.push({ date: d, start: s.start, end: s.start + s.duration, duration: s.duration, staffId: s.staffId, clientId: s.clientId, slotId: s.id, kind: s.kind, memo: s.memo, key: `t:${s.id}:${d}` })
      }
    }
    plan.conflicts = findConflicts(plan.create, existing)
    return plan
  }

  /** mode=all：重複も承知で全部作る / skipConflicts：重複する枠を除いて作る。どちらも一度に保存する */
  async applyTemplate(from: string, to: string, mode: 'strict' | 'all' | 'skipConflicts', slotIds?: string[]) {
    const plan = await this.planTemplate(from, to, slotIds)
    if (plan.conflicts.length && mode === 'strict') throw this.conflictError(plan.conflicts)
    const bad = new Set(plan.conflicts.flatMap((c) => [`${c.date}|${c.staffId}|${c.a.clientId}|${c.a.start}`, ...(c.b.key === 'new' ? [`${c.date}|${c.staffId}|${c.b.clientId}|${c.b.start}`] : [])]))
    const list = mode === 'skipConflicts' ? plan.create.filter((c) => !bad.has(`${c.date}|${c.staffId}|${c.clientId}|${c.start}`)) : plan.create
    const t = this.now()
    const ops: Op[] = list.map((c) => ({
      t: 'put',
      table: 'visits',
      row: { id: this.newId(), date: c.date, start: c.start, duration: c.duration, staffId: c.staffId, clientId: c.clientId, kind: c.kind, memo: c.memo, status: 'scheduled', seriesId: null, occDate: null, templateId: c.slotId, createdAt: t, updatedAt: t } satisfies Visit,
    }))
    if (ops.length) await this.ds.apply(ops)
    return { created: ops.length, skipped: plan.skipped.length + (plan.create.length - list.length) }
  }
}
