// メモリ上の DataSource（デモのブラウザ保存とテストで使用）
import type { DataSource } from './service'
import type { Client, Op, Series, Staff, Table, TemplateSlot, Visit } from './types'

export interface Tables {
  visits: Record<string, Visit>
  series: Record<string, Series>
  clients: Record<string, Client>
  staff: Record<string, Staff>
  templates: Record<string, TemplateSlot>
}

export const emptyTables = (): Tables => ({ visits: {}, series: {}, clients: {}, staff: {}, templates: {} })

const clone = <T>(v: T): T => structuredClone(v)

export class MemoryDataSource implements DataSource {
  constructor(
    public tables: Tables,
    private onChange?: (t: Tables) => void,
  ) {}

  async seriesBetween(from: string, to: string) {
    return Object.values(this.tables.series).filter((s) => s.startDate <= to && (!s.endDate || s.endDate >= from)).map(clone)
  }
  async visitsBetween(from: string, to: string) {
    return Object.values(this.tables.visits)
      .filter((v) => (v.date >= from && v.date <= to) || (v.occDate !== null && v.occDate >= from && v.occDate <= to))
      .map(clone)
  }
  async getSeries(id: string) {
    const s = this.tables.series[id]
    return s ? clone(s) : null
  }
  async getVisit(id: string) {
    const v = this.tables.visits[id]
    return v ? clone(v) : null
  }
  async overridesOf(seriesId: string, from: string) {
    return Object.values(this.tables.visits).filter((v) => v.seriesId === seriesId && v.occDate !== null && v.occDate >= from).map(clone)
  }
  async overrideAt(seriesId: string, occDate: string) {
    const v = Object.values(this.tables.visits).find((x) => x.seriesId === seriesId && x.occDate === occDate)
    return v ? clone(v) : null
  }
  async listSeries() {
    return Object.values(this.tables.series).map(clone)
  }
  async listClients() {
    return Object.values(this.tables.clients).map(clone)
  }
  async listStaff() {
    return Object.values(this.tables.staff).sort((a, b) => a.sort - b.sort).map(clone)
  }
  async listTemplates() {
    return Object.values(this.tables.templates).map(clone)
  }
  /** 一括で適用（途中で失敗したら元に戻す）。定期の同じ回に例外が2つできないことも確認する */
  async apply(ops: Op[]) {
    const next = clone(this.tables)
    for (const op of ops) {
      const t = next[op.table as Table] as Record<string, unknown>
      if (op.t === 'put') t[op.row.id] = clone(op.row)
      else delete t[op.id]
    }
    const seen = new Set<string>()
    for (const v of Object.values(next.visits)) {
      if (!v.seriesId) continue
      const k = `${v.seriesId}|${v.occDate}`
      if (seen.has(k)) throw new Error('duplicate override')
      seen.add(k)
    }
    this.tables = next
    this.onChange?.(next)
  }
}
