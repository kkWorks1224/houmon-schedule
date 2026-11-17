// 画面・ローカル保存・サーバ（D1）で共通に使う型

export type Kind = 'nursing' | 'rehab' | 'other'
export type Status = 'scheduled' | 'done' | 'skipped'

export const KIND_LABEL: Record<Kind, string> = { nursing: '看護', rehab: 'リハビリ', other: 'その他' }
export const KIND_SHORT: Record<Kind, string> = { nursing: '看', rehab: 'リ', other: '他' }
export const STATUS_LABEL: Record<Status, string> = { scheduled: '予定', done: '完了', skipped: 'お休み' }

/** 担当者。id は固定（表示名を変えても予定との紐付けは id で保たれる） */
export interface Staff {
  id: string
  name: string
  /** 色に頼らず見分けるための1文字 */
  mark: string
  sort: number
}

export interface Client {
  id: string
  name: string
  kana: string
  defaultDuration: number
  defaultKind: Kind
  defaultStaffId: string
  /** 標準の開始時刻（分）。空き時間から追加したときは使わない */
  defaultStart: number | null
  memo: string
  active: boolean
  useCount: number
  lastUsedAt: number
  updatedAt: number
}

/** 定期訪問のルール。各回は保存せず、表示する期間だけ展開する */
export interface Series {
  id: string
  clientId: string
  staffId: string
  start: number
  duration: number
  kind: Kind
  memo: string
  /** 0=日 … 6=土 */
  weekdays: number[]
  interval: 1 | 2
  startDate: string
  endDate: string | null
  /** 隔週の基準週（月曜日）。分割しても元の隔週の並びを保つ */
  anchor: string
  createdAt: number
  updatedAt: number
}

/**
 * 訪問1件。
 * - seriesId が null：単発の予定
 * - seriesId あり：定期訪問のある回（occDate）の例外（時刻・担当の変更、お休み、完了）
 */
export interface Visit {
  id: string
  date: string
  start: number
  duration: number
  staffId: string
  clientId: string
  kind: Kind
  memo: string
  status: Status
  seriesId: string | null
  occDate: string | null
  templateId: string | null
  createdAt: number
  updatedAt: number
}

/** 基本の週間予定の1枠 */
export interface TemplateSlot {
  id: string
  weekday: number
  start: number
  duration: number
  staffId: string
  clientId: string
  kind: Kind
  memo: string
  updatedAt: number
}

/** 画面に出す1回分（単発・定期の回・例外を同じ形にしたもの） */
export interface Occ {
  key: string
  visitId: string | null
  seriesId: string | null
  occDate: string | null
  date: string
  start: number
  duration: number
  end: number
  staffId: string
  clientId: string
  kind: Kind
  memo: string
  status: Status
  /** 定期の回のうち、個別に変更されたもの */
  exception: boolean
  updatedAt: number
}

/** 予定の入力値（新規・単発編集・定期の回の編集で共通） */
export interface VisitDraft {
  clientId: string
  date: string
  start: number
  duration: number
  staffId: string
  kind: Kind
  memo: string
}

export interface RepeatDraft {
  weekdays: number[]
  interval: 1 | 2
  startDate: string
  endDate: string | null
}

export interface Conflict {
  date: string
  staffId: string
  /** 保存しようとしている予定 */
  a: { clientId: string; start: number; end: number }
  /** 重なる既存の予定 */
  b: { clientId: string; start: number; end: number; key: string }
}

export type Table = 'visits' | 'series' | 'clients' | 'staff' | 'templates'
export type Op = { t: 'put'; table: Table; row: Visit | Series | Client | Staff | TemplateSlot } | { t: 'del'; table: Table; id: string }

export interface Member {
  email: string
  role: 'admin' | 'staff'
  addedAt: number
}

export class AppError extends Error {
  constructor(
    public code: 'conflict' | 'stale' | 'not_found' | 'invalid' | 'forbidden',
    message: string,
    public detail?: unknown,
  ) {
    super(message)
  }
}
