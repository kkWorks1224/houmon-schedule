// D1 の DataSource。列名は snake_case、アプリ側は camelCase。
import type { DataSource } from '../shared/service'
import type { Client, Op, Series, Staff, Table, TemplateSlot, Visit } from '../shared/types'

type Row = Record<string, unknown>

const COLS: Record<Table, string[]> = {
  visits: ['id', 'date', 'start', 'duration', 'staffId', 'clientId', 'kind', 'memo', 'status', 'seriesId', 'occDate', 'templateId', 'createdAt', 'updatedAt'],
  series: ['id', 'clientId', 'staffId', 'start', 'duration', 'kind', 'memo', 'weekdays', 'interval', 'startDate', 'endDate', 'anchor', 'createdAt', 'updatedAt'],
  clients: ['id', 'name', 'kana', 'defaultDuration', 'defaultKind', 'defaultStaffId', 'defaultStart', 'memo', 'active', 'useCount', 'lastUsedAt', 'updatedAt'],
  staff: ['id', 'name', 'mark', 'sort'],
  templates: ['id', 'weekday', 'start', 'duration', 'staffId', 'clientId', 'kind', 'memo', 'updatedAt'],
}
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

function toApp<T>(table: Table, r: Row): T {
  const o: Row = {}
  for (const k of COLS[table]) o[k] = r[snake(k)]
  if (table === 'series') o.weekdays = JSON.parse(String(o.weekdays))
  if (table === 'clients') o.active = !!o.active
  return o as T
}
function toDb(table: Table, row: Row): unknown[] {
  return COLS[table].map((k) => {
    const v = row[k]
    if (table === 'series' && k === 'weekdays') return JSON.stringify(v)
    if (typeof v === 'boolean') return v ? 1 : 0
    return v ?? null
  })
}

export class D1DataSource implements DataSource {
  constructor(
    private db: D1Database,
    private audit?: { email: string; action: string },
  ) {}

  private async all<T>(table: Table, sql: string, ...args: unknown[]) {
    const { results } = await this.db.prepare(sql).bind(...args).all<Row>()
    return results.map((r) => toApp<T>(table, r))
  }
  private async one<T>(table: Table, sql: string, ...args: unknown[]) {
    const r = await this.db.prepare(sql).bind(...args).first<Row>()
    return r ? toApp<T>(table, r) : null
  }

  seriesBetween(from: string, to: string) {
    return this.all<Series>('series', 'SELECT * FROM series WHERE start_date <= ?2 AND (end_date IS NULL OR end_date >= ?1)', from, to)
  }
  visitsBetween(from: string, to: string) {
    return this.all<Visit>('visits', 'SELECT * FROM visits WHERE date BETWEEN ?1 AND ?2 UNION SELECT * FROM visits WHERE series_id IS NOT NULL AND occ_date BETWEEN ?1 AND ?2', from, to)
  }
  getSeries(id: string) {
    return this.one<Series>('series', 'SELECT * FROM series WHERE id = ?1', String(id))
  }
  getVisit(id: string) {
    return this.one<Visit>('visits', 'SELECT * FROM visits WHERE id = ?1', String(id))
  }
  overridesOf(seriesId: string, from: string) {
    return this.all<Visit>('visits', 'SELECT * FROM visits WHERE series_id = ?1 AND occ_date >= ?2', String(seriesId), String(from))
  }
  overrideAt(seriesId: string, occDate: string) {
    return this.one<Visit>('visits', 'SELECT * FROM visits WHERE series_id = ?1 AND occ_date = ?2', String(seriesId), String(occDate))
  }
  listSeries() {
    return this.all<Series>('series', 'SELECT * FROM series')
  }
  listClients() {
    return this.all<Client>('clients', 'SELECT * FROM clients ORDER BY kana')
  }
  listStaff() {
    return this.all<Staff>('staff', 'SELECT * FROM staff ORDER BY sort')
  }
  listTemplates() {
    return this.all<TemplateSlot>('templates', 'SELECT * FROM templates')
  }

  /** D1 の batch は1つのトランザクションとして実行される（全部か無しか） */
  async apply(ops: Op[]) {
    if (!ops.length) return
    const stmts = ops.map((op) => {
      if (op.t === 'del') return this.db.prepare(`DELETE FROM ${op.table} WHERE id = ?1`).bind(op.id)
      const cols = COLS[op.table].map(snake)
      return this.db.prepare(`INSERT OR REPLACE INTO ${op.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...toDb(op.table, op.row as unknown as Row))
    })
    if (this.audit) stmts.push(this.db.prepare('INSERT INTO audit_log (at, email, action, ops) VALUES (?1, ?2, ?3, ?4)').bind(Date.now(), this.audit.email, this.audit.action, ops.length))
    await this.db.batch(stmts)
  }
}
