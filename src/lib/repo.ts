// データアクセス層。画面はこの Repo だけを使う。
// - LocalRepo：ブラウザ保存（デモ）。業務ロジックはサーバと同じ Service をブラウザ内で動かす
// - ApiRepo：Cloudflare Workers + D1（Google ログイン・利用登録が必要）
import { MemoryDataSource, type Tables } from '../../shared/memory'
import { parseText, type Parsed } from '../../shared/parse'
import { CLIENTS, makeSeed } from '../../shared/seed'
import { Service } from '../../shared/service'
import { AppError } from '../../shared/types'
import { todayJST } from '../../shared/date'

type Methods = {
  [K in keyof Service as Service[K] extends (...a: never[]) => Promise<unknown> ? K : never]: Service[K]
}
export type Method = keyof Methods
type Args<M extends Method> = Parameters<Methods[M]>
type Result<M extends Method> = Awaited<ReturnType<Methods[M]>>

export class NetError extends Error {
  code = 'network' as const
}

export interface Repo {
  kind: 'local' | 'api'
  call<M extends Method>(method: M, ...args: Args<M>): Promise<Result<M>>
  parse(text: string): Promise<Parsed>
}

const DEMO_KEY = 'houmon-demo-v1'

export class LocalRepo implements Repo {
  kind = 'local' as const
  private svc: Service
  private ds: MemoryDataSource
  constructor() {
    let tables: Tables | null = null
    try {
      const raw = localStorage.getItem(DEMO_KEY)
      if (raw) tables = JSON.parse(raw)
      // 住所欄を追加する前に保存されたデモデータには、架空の地域名を補う
      if (tables) for (const c of Object.values(tables.clients)) c.address ??= CLIENTS.find((x) => x.id === c.id)?.address ?? ''
    } catch {
      tables = null
    }
    this.ds = new MemoryDataSource(tables ?? makeSeed(todayJST()), (t) => {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(t))
      } catch {
        throw new AppError('invalid', 'この端末に保存できませんでした（保存容量やプライベートブラウズを確認してください）')
      }
    })
    if (!tables) this.persist()
    this.svc = new Service(this.ds)
  }
  private persist() {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(this.ds.tables))
    } catch {
      /* 保存できない環境でもメモリ上で操作はできる */
    }
  }
  async call<M extends Method>(method: M, ...args: Args<M>): Promise<Result<M>> {
    // サーバと同じく値はコピーして渡す（画面側の状態を書き換えないように）
    const copy = structuredClone(args) as unknown[]
    const fn = this.svc[method] as unknown as (...a: unknown[]) => Promise<Result<M>>
    const isWrite = !['range', 'bootstrap', 'checkVisit', 'previewSeries', 'previewFollowing', 'planTemplate'].includes(method)
    if (isWrite) await new Promise((r) => setTimeout(r, 180))
    return structuredClone(await fn.apply(this.svc, copy))
  }
  async parse(text: string) {
    const { staff, clients } = await this.svc.bootstrap()
    return parseText(text, clients, staff)
  }
  static reset() {
    try {
      localStorage.removeItem(DEMO_KEY)
    } catch {
      /* noop */
    }
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
  } catch {
    throw new NetError('通信できませんでした。電波の状態を確認してもう一度お試しください')
  }
  const data = (await res.json().catch(() => ({}))) as { result?: T; error?: string; message?: string; detail?: unknown }
  if (!res.ok) {
    if (res.status === 401) location.reload()
    const code = (['conflict', 'stale', 'not_found', 'invalid', 'forbidden'] as const).find((c) => c === data.error) ?? 'invalid'
    throw new AppError(code, data.message ?? `エラーが発生しました（${res.status}）`, data.detail)
  }
  return data.result as T
}

export class ApiRepo implements Repo {
  kind = 'api' as const
  call<M extends Method>(method: M, ...args: Args<M>): Promise<Result<M>> {
    return post<Result<M>>(`/api/rpc/${method}`, { args })
  }
  async parse(text: string): Promise<Parsed> {
    return post<Parsed>('/api/ai/parse', { text })
  }
}

export const errMessage = (e: unknown) => (e instanceof Error ? e.message : '保存できませんでした')
