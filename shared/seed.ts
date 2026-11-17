// 初期表示用の架空データ（実在の人物・利用者情報ではありません）
import { addDays, mondayOf } from './date'
import type { Tables } from './memory'
import type { Client, Kind, Series, Staff, TemplateSlot, Visit } from './types'

export const STAFF: Staff[] = [
  { id: 'st_endo', name: '遠藤さん', mark: '遠', sort: 1 },
  { id: 'st_nozomi', name: 'のぞみん', mark: 'の', sort: 2 },
  { id: 'st_muneto', name: 'むねと', mark: 'む', sort: 3 },
]

/** 架空の利用者なので、住所は町名までの地域（実在の個人宅ではない） */
const ADDR: Record<string, string> = {
  cl_aoki: '山梨県甲府市丸の内',
  cl_ishi: '山梨県甲府市飯田',
  cl_ueno: '山梨県甲府市朝日',
  cl_eguchi: '山梨県甲府市富士見',
  cl_oka: '山梨県甲府市北新',
  cl_kato: '山梨県甲斐市竜王',
  cl_kino: '山梨県甲府市相生',
  cl_kubo: '山梨県中央市山之神',
  cl_koma: '山梨県甲府市大里町',
  cl_shimi: '山梨県昭和町西条',
  cl_tamu: '山梨県甲府市住吉',
}

const C = (id: string, name: string, kana: string, dur: number, kind: Kind, staff: string, start: number | null, memo = '', uses = 0): Client => ({
  id,
  name,
  kana,
  defaultDuration: dur,
  defaultKind: kind,
  defaultStaffId: staff,
  defaultStart: start,
  address: ADDR[id] ?? '',
  memo,
  active: true,
  useCount: uses,
  lastUsedAt: 0,
  updatedAt: 0,
})

export const CLIENTS: Client[] = [
  C('cl_aoki', '青葉 さくら', 'あおば さくら', 60, 'nursing', 'st_endo', 540, '玄関は裏口から', 12),
  C('cl_ishi', '石川 和男', 'いしかわ かずお', 40, 'rehab', 'st_nozomi', 630, '', 9),
  C('cl_ueno', '上原 トメ', 'うえはら とめ', 30, 'nursing', 'st_muneto', 810, 'インスリン確認', 14),
  C('cl_eguchi', '江川 正', 'えがわ ただし', 60, 'nursing', 'st_endo', 900, '', 4),
  C('cl_oka', '大岡 光代', 'おおおか みつよ', 60, 'rehab', 'st_nozomi', 840, '', 6),
  C('cl_kato', '片山 茂', 'かたやま しげる', 45, 'nursing', 'st_muneto', 600, '駐車は向かいの空き地', 7),
  C('cl_kino', '木村 春江', 'きむら はるえ', 30, 'nursing', 'st_endo', 690, '', 3),
  C('cl_kubo', '久保田 勇', 'くぼた いさむ', 60, 'rehab', 'st_muneto', 930, '', 2),
  C('cl_koma', '小森 千代', 'こもり ちよ', 90, 'nursing', 'st_nozomi', 570, '入浴介助あり', 5),
  C('cl_sasa', '笹本 実', 'ささもと みのる', 30, 'other', 'st_endo', 960, '', 1),
  C('cl_shimi', '島田 文子', 'しまだ ふみこ', 60, 'nursing', 'st_muneto', 540, '', 2),
  C('cl_tamu', '田中 幸雄', 'たなか ゆきお', 40, 'rehab', 'st_nozomi', 960, '', 1),
]

export function makeSeed(today: string, now = Date.now()): Tables {
  const base = addDays(mondayOf(today), -14)
  const S = (id: string, clientId: string, staffId: string, start: number, duration: number, kind: Kind, weekdays: number[], interval: 1 | 2 = 1, memo = ''): Series => ({
    id,
    clientId,
    staffId,
    start,
    duration,
    kind,
    memo,
    weekdays,
    interval,
    startDate: base,
    endDate: null,
    anchor: base,
    createdAt: now,
    updatedAt: now,
  })
  const series: Series[] = [
    S('se_aoki', 'cl_aoki', 'st_endo', 540, 60, 'nursing', [1, 4]),
    S('se_ishi', 'cl_ishi', 'st_nozomi', 630, 40, 'rehab', [2, 5]),
    S('se_ueno', 'cl_ueno', 'st_muneto', 810, 30, 'nursing', [1, 3, 5]),
    S('se_eguchi', 'cl_eguchi', 'st_endo', 900, 60, 'nursing', [3], 2),
    S('se_oka', 'cl_oka', 'st_nozomi', 840, 60, 'rehab', [1, 4]),
    S('se_kato', 'cl_kato', 'st_muneto', 600, 45, 'nursing', [2, 4]),
    S('se_koma', 'cl_koma', 'st_nozomi', 570, 90, 'nursing', [3]),
    S('se_shimi', 'cl_shimi', 'st_muneto', 540, 60, 'nursing', [1, 5]),
    S('se_kubo', 'cl_kubo', 'st_muneto', 930, 60, 'rehab', [2], 2),
  ]
  const V = (id: string, date: string, clientId: string, staffId: string, start: number, duration: number, kind: Kind, memo = ''): Visit => ({
    id,
    date,
    start,
    duration,
    staffId,
    clientId,
    kind,
    memo,
    status: 'scheduled',
    seriesId: null,
    occDate: null,
    templateId: null,
    createdAt: now,
    updatedAt: now,
  })
  const visits: Visit[] = [
    V('vi_seed1', today, 'cl_kino', 'st_endo', 690, 30, 'nursing', '臨時：状態確認'),
    V('vi_seed2', today, 'cl_sasa', 'st_endo', 960, 30, 'other', ''),
    V('vi_seed3', addDays(today, 1), 'cl_tamu', 'st_nozomi', 960, 40, 'rehab', ''),
    V('vi_seed4', addDays(today, 2), 'cl_kino', 'st_endo', 690, 30, 'nursing', ''),
  ]
  const templates: TemplateSlot[] = [
    { id: 'tp_kino_tue', weekday: 2, start: 690, duration: 30, staffId: 'st_endo', clientId: 'cl_kino', kind: 'nursing', memo: '', updatedAt: now },
    { id: 'tp_tamu_thu', weekday: 4, start: 960, duration: 40, staffId: 'st_nozomi', clientId: 'cl_tamu', kind: 'rehab', memo: '', updatedAt: now },
    { id: 'tp_sasa_fri', weekday: 5, start: 960, duration: 30, staffId: 'st_endo', clientId: 'cl_sasa', kind: 'other', memo: '', updatedAt: now },
  ]
  const by = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, structuredClone(x)]))
  return { staff: by(STAFF), clients: by(CLIENTS.map((c, i) => ({ ...c, lastUsedAt: now - i * 3600e3 }))), series: by(series), visits: by(visits), templates: by(templates) }
}
