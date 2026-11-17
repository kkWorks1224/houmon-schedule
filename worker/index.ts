import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { todayJST, WD } from '../shared/date'
import { parseText } from '../shared/parse'
import { makeSeed, STAFF } from '../shared/seed'
import { Service } from '../shared/service'
import { AppError, type Op } from '../shared/types'
import { D1DataSource } from './d1'

type User = { id: string; email: string; name: string; picture: string }
type Role = 'admin' | 'staff'
type Env = {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID: string
  AI_MODEL: string
  /** 最初の管理者（カンマ区切りのメールアドレス）。`wrangler secret put ADMIN_EMAILS` で設定 */
  ADMIN_EMAILS?: string
  DEV_LOGIN?: string
  AI_LIMITER?: RateLimit
  API_LIMITER?: RateLimit
}
type Vars = { user: User; role: Role }
type C = import('hono').Context<{ Bindings: Env; Variables: Vars }>

const SESSION_DAYS = 30
const AI_DAILY_LIMIT = 200
const MAX_BODY = 256 * 1024

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

const baseHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  referrerPolicy: 'strict-origin-when-cross-origin',
  xFrameOptions: 'DENY',
})
app.use('*', (c, next) => (c.req.path === '/auth/callback' ? next() : baseHeaders(c, next)))

// 状態を変えるリクエストは自オリジンからのみ（SameSite Cookie に加えた CSRF 対策）
app.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
  const self = new URL(c.req.url).origin
  const origin = c.req.header('origin')
  const site = c.req.header('sec-fetch-site')
  if (origin ? origin !== self : site && site !== 'same-origin') return c.json({ error: 'forbidden' }, 403)
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) return c.json({ error: 'too_large' }, 413)
  return next()
})

app.onError((err, c) => {
  if (err instanceof AppError) {
    const status = err.code === 'conflict' || err.code === 'stale' ? 409 : err.code === 'not_found' ? 404 : err.code === 'forbidden' ? 403 : 400
    return c.json({ error: err.code, message: err.message, detail: err.detail ?? null }, status)
  }
  if (err instanceof SyntaxError) return c.json({ error: 'invalid', message: 'リクエストの形式が正しくありません' }, 400)
  if (String(err).includes('UNIQUE')) return c.json({ error: 'stale', message: 'ほかの端末で同時に変更されました。表示を更新してください' }, 409)
  console.error(err)
  return c.json({ error: 'internal', message: 'サーバでエラーが発生しました' }, 500)
})

// ---------- helpers ----------
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const b64urlDecode = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (ch) => ch.charCodeAt(0))
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)))
const sha256 = async (s: string) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
const isSecure = (url: string) => new URL(url).protocol === 'https:'
const norm = (e: string) => e.trim().toLowerCase()

async function createSession(c: C, user: User) {
  const db = c.env.DB
  await db
    .prepare(
      `INSERT INTO users (id, email, name, picture, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`,
    )
    .bind(user.id, user.email, user.name, user.picture, Date.now())
    .run()
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(Date.now()).run()
  const token = randomToken()
  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)')
    .bind(await sha256(token), user.id, Date.now() + SESSION_DAYS * 864e5)
    .run()
  setCookie(c, 'sid', token, { httpOnly: true, secure: isSecure(c.req.url), sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 })
}

async function currentUser(c: C): Promise<User | null> {
  const token = getCookie(c, 'sid')
  if (!token) return null
  return (
    (await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?1 AND s.expires_at > ?2`,
    )
      .bind(await sha256(token), Date.now())
      .first<User>()) ?? null
  )
}

/** 利用許可：members に登録されたメール、または ADMIN_EMAILS（最初の管理者） */
async function roleOf(c: C, email: string): Promise<Role | null> {
  const e = norm(email)
  if (!e) return null
  const admins = (c.env.ADMIN_EMAILS ?? '').split(',').map(norm).filter(Boolean)
  if (admins.includes(e)) return 'admin'
  const m = await c.env.DB.prepare('SELECT role FROM members WHERE email = ?1').bind(e).first<{ role: Role }>()
  return m?.role ?? null
}

// ---------- auth：Google OpenID Connect（ID トークンを Google の公開鍵で検証。クライアントシークレット不要） ----------
type Jwk = JsonWebKey & { kid: string }
let jwksCache: { at: number; keys: Jwk[] } | null = null
async function googleKeys(force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs')
  const { keys } = (await r.json()) as { keys: Jwk[] }
  jwksCache = { at: Date.now(), keys }
  return keys
}

async function verifyIdToken(token: string, clientId: string, nonce: string) {
  try {
    if (token.length > 8192) return null
    const [h, p, sig] = token.split('.')
    if (!h || !p || !sig) return null
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)))
    if (header.alg !== 'RS256') return null
    let jwk = (await googleKeys()).find((k) => k.kid === header.kid)
    if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`))
    if (!ok) return null
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)))
    const validIss = ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)
    if (!validIss || claims.aud !== clientId || claims.exp * 1000 < Date.now() || claims.nonce !== nonce) return null
    // メール確認済みのアカウントだけ（許可リストをメールで照合するため）
    if (claims.email_verified !== true) return null
    return claims as { sub: string; email: string; name?: string; picture?: string }
  } catch {
    return null
  }
}

app.get('/auth/login', (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.text('Google OAuth is not configured', 503)
  const state = randomToken(16)
  const nonce = randomToken(16)
  setCookie(c, 'oauth', `${state}.${nonce}`, { httpOnly: true, secure: isSecure(c.req.url), sameSite: 'Lax', path: '/auth', maxAge: 600 })
  const q = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: new URL('/auth/callback', c.req.url).toString(),
    response_type: 'id_token',
    response_mode: 'fragment',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`)
})

// ID トークンは URL フラグメントで返る（サーバに届かない）ので、小さなページで受け取り /auth/complete へ送る
app.get('/auth/callback', (c) =>
  c.html('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ログイン中</title><script src="/callback.js"></script>', 200, {
    'content-security-policy': "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  }),
)

app.post('/auth/complete', async (c) => {
  const [state, nonce] = (getCookie(c, 'oauth') ?? '').split('.')
  deleteCookie(c, 'oauth', { path: '/auth' })
  const body = await c.req.json<{ id_token?: string; state?: string }>()
  if (!state || !nonce || body.state !== state || typeof body.id_token !== 'string') return c.json({ error: 'bad_state' }, 400)
  const claims = await verifyIdToken(body.id_token, c.env.GOOGLE_CLIENT_ID, nonce)
  if (!claims) return c.json({ error: 'invalid_token' }, 400)
  await createSession(c, { id: `g:${claims.sub}`, email: norm(claims.email), name: claims.name ?? '', picture: claims.picture ?? '' })
  return c.json({ ok: true })
})

// ローカル開発専用（.dev.vars の DEV_LOGIN=1 かつ localhost のときだけ有効）
app.get('/auth/dev', async (c) => {
  const host = new URL(c.req.url).hostname
  if (c.env.DEV_LOGIN !== '1' || !['localhost', '127.0.0.1'].includes(host)) return c.notFound()
  const email = c.req.query('as') === 'staff' ? 'staff@example.test' : 'admin@example.test'
  if (email === 'admin@example.test') await c.env.DB.prepare("INSERT OR IGNORE INTO members (email, role, added_at) VALUES (?1, 'admin', ?2)").bind(email, Date.now()).run()
  await createSession(c, { id: `dev:${email}`, email, name: email.startsWith('admin') ? '開発 管理者' : '開発 スタッフ', picture: '' })
  return c.redirect('/')
})

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, 'sid')
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(await sha256(token)).run()
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

// ---------- api ----------
app.get('/api/me', async (c) => {
  const user = await currentUser(c)
  const role = user ? await roleOf(c, user.email) : null
  return c.json({ user: user ? { email: user.email, name: user.name, picture: user.picture } : null, role }, 200, { 'cache-control': 'no-store' })
})

app.use('/api/*', async (c, next) => {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'unauthorized', message: 'ログインしてください' }, 401)
  const role = await roleOf(c, user.email)
  if (!role) return c.json({ error: 'not_member', message: 'このアカウントは利用登録されていません' }, 403)
  if (c.env.API_LIMITER && !(await c.env.API_LIMITER.limit({ key: user.id })).success) return c.json({ error: 'rate_limited', message: '操作が多すぎます。少し待ってから再度お試しください' }, 429)
  c.set('user', user)
  c.set('role', role)
  await next()
})

/** 初回だけ担当者（固定ID）と架空のデモデータを入れる */
async function ensureSeeded(db: D1Database) {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM staff').first<{ n: number }>()
  if (n && n.n > 0) return
  const seed = makeSeed(todayJST())
  const ops: Op[] = [
    ...STAFF.map((row) => ({ t: 'put', table: 'staff', row }) as Op),
    ...Object.values(seed.clients).map((row) => ({ t: 'put', table: 'clients', row }) as Op),
    ...Object.values(seed.series).map((row) => ({ t: 'put', table: 'series', row }) as Op),
    ...Object.values(seed.visits).map((row) => ({ t: 'put', table: 'visits', row }) as Op),
    ...Object.values(seed.templates).map((row) => ({ t: 'put', table: 'templates', row }) as Op),
  ]
  await new D1DataSource(db).apply(ops)
}

// 画面から呼べる業務操作（Service のメソッドを許可リストで公開。入力の検証は Service 側）
const READ = ['range', 'bootstrap', 'checkVisit', 'previewSeries', 'previewFollowing', 'planTemplate'] as const
const WRITE = ['createVisit', 'updateVisit', 'deleteVisit', 'setStatus', 'createSeries', 'editOne', 'editFollowing', 'cancel', 'saveClient', 'renameStaff', 'saveTemplate', 'deleteTemplate', 'applyTemplate'] as const
type Method = (typeof READ)[number] | (typeof WRITE)[number]

app.post('/api/rpc/:method', async (c) => {
  const method = c.req.param('method') as Method
  const isWrite = (WRITE as readonly string[]).includes(method)
  if (!isWrite && !(READ as readonly string[]).includes(method)) return c.json({ error: 'not_found', message: '操作が見つかりません' }, 404)
  const { args } = await c.req.json<{ args?: unknown[] }>()
  if (!Array.isArray(args) || args.length > 8) return c.json({ error: 'invalid', message: '引数が正しくありません' }, 400)
  if (method === 'bootstrap') await ensureSeeded(c.env.DB)
  const svc = new Service(new D1DataSource(c.env.DB, isWrite ? { email: c.get('user').email, action: method } : undefined))
  const fn = svc[method] as (...a: unknown[]) => Promise<unknown>
  const result = await fn.apply(svc, args)
  return c.json({ result: result ?? null }, 200, { 'cache-control': 'no-store' })
})

// ---------- 管理者：利用者（スタッフ）アカウントの登録 ----------
const adminOnly = async (c: C, next: () => Promise<void>) => {
  if (c.get('role') !== 'admin') return c.json({ error: 'forbidden', message: '管理者のみ操作できます' }, 403)
  await next()
}
app.get('/api/members', adminOnly, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT email, role, added_at AS addedAt FROM members ORDER BY added_at').all()
  const env = (c.env.ADMIN_EMAILS ?? '').split(',').map(norm).filter(Boolean)
  return c.json({ members: results, fixedAdmins: env }, 200, { 'cache-control': 'no-store' })
})
app.post('/api/members', adminOnly, async (c) => {
  const { email, role } = await c.req.json<{ email?: string; role?: string }>()
  const e = norm(String(email ?? ''))
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) return c.json({ error: 'invalid', message: 'メールアドレスを正しく入力してください', detail: { email: 'メールアドレスを正しく入力してください' } }, 400)
  if (role !== 'admin' && role !== 'staff') return c.json({ error: 'invalid', message: '権限を選んでください' }, 400)
  await c.env.DB.prepare('INSERT INTO members (email, role, added_at) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO UPDATE SET role = excluded.role').bind(e, role, Date.now()).run()
  return c.json({ ok: true })
})
app.delete('/api/members/:email', adminOnly, async (c) => {
  const e = norm(decodeURIComponent(c.req.param('email') ?? ''))
  if (e === c.get('user').email) return c.json({ error: 'invalid', message: '自分自身は削除できません' }, 400)
  await c.env.DB.prepare('DELETE FROM members WHERE email = ?1').bind(e).run()
  return c.json({ ok: true })
})
/** 架空のデモデータを消して本番の入力を始める（担当者は残す） */
app.post('/api/admin/clear', adminOnly, async (c) => {
  const { confirm } = await c.req.json<{ confirm?: string }>()
  if (confirm !== 'すべて削除') return c.json({ error: 'invalid', message: '確認の文字が一致しません' }, 400)
  await c.env.DB.batch(['visits', 'series', 'clients', 'templates'].map((t) => c.env.DB.prepare(`DELETE FROM ${t}`)))
  return c.json({ ok: true })
})

// ---------- Workers AI：文章から予定の入力欄を埋める ----------
app.post('/api/ai/parse', async (c) => {
  const user = c.get('user')
  if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: user.id })).success) return c.json({ error: 'rate_limited', message: 'AI の利用が多すぎます。1分ほど待ってください' }, 429)
  const day = todayJST()
  const used = await c.env.DB.prepare(
    `INSERT INTO ai_usage (user_id, day, count) VALUES (?1, ?2, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 RETURNING count`,
  )
    .bind(user.id, day)
    .first<{ count: number }>()
  if ((used?.count ?? 0) > AI_DAILY_LIMIT) return c.json({ error: 'rate_limited', message: '本日の AI 利用上限に達しました' }, 429)

  const { text } = await c.req.json<{ text?: string }>()
  const input = String(text ?? '').trim().slice(0, 300)
  if (!input) return c.json({ error: 'invalid', message: '文章を入力してください' }, 400)
  const svc = new Service(new D1DataSource(c.env.DB))
  const { staff, clients } = await svc.bootstrap()
  const system = [
    'あなたは訪問看護ステーションの予定入力を補助します。利用者の発話から予定の項目を JSON で抜き出してください。',
    `今日は ${day}（${WD[new Date(`${day}T00:00:00Z`).getUTCDay()]}曜日、Asia/Tokyo）。`,
    `担当者：${staff.map((s) => s.name).join('、')}`,
    `利用者：${clients.filter((x) => x.active).map((x) => `${x.name}（${x.kana}）`).join('、')}`,
    '分からない項目は null にする。推測で埋めない。時刻は 24 時間表記 HH:MM。曜日は 0=日〜6=土 の数値配列。',
    '「毎週」「隔週」「月・木」など繰り返しの指定があるときだけ weekdays と interval を入れる。',
    '「来週から」「12月から」など開始の指定は date に開始日（YYYY-MM-DD）として入れる。来週＝次の月曜日から始まる週。',
    'memo には訪問時の注意事項だけを入れる。日時・繰り返し・担当者・開始時期の指示は memo に入れない。',
  ].join('\n')
  const schema = {
    type: 'object',
    properties: {
      client: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      start: { type: ['string', 'null'], description: 'HH:MM' },
      duration: { type: ['integer', 'null'], description: '分' },
      staff: { type: ['string', 'null'] },
      kind: { type: ['string', 'null'], enum: ['看護', 'リハビリ', 'その他', null] },
      weekdays: { type: ['array', 'null'], items: { type: 'integer' } },
      interval: { type: ['integer', 'null'], enum: [1, 2, null] },
      memo: { type: ['string', 'null'] },
    },
    required: ['client', 'date', 'start', 'duration', 'staff', 'kind', 'weekdays', 'interval', 'memo'],
  }
  let out: Record<string, unknown> | null = null
  try {
    const r = (await c.env.AI.run(c.env.AI_MODEL as keyof AiModels, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_schema', json_schema: schema },
      max_tokens: 300,
      temperature: 0,
    } as never)) as { response?: unknown }
    out = typeof r.response === 'string' ? JSON.parse(r.response) : (r.response as Record<string, unknown>)
  } catch (e) {
    console.error('ai', e)
    return c.json({ error: 'ai_failed', message: 'AI で読み取れませんでした' }, 502)
  }
  // 名前を ID に対応づけ、値の範囲を確認してから返す（AI の出力はそのまま信用しない）
  const pick = (name: unknown, list: { id: string; name: string; kana?: string }[]) => {
    const n = String(name ?? '').replace(/\s|さん$|様$/g, '')
    // 1文字だけの部分一致は別人を選びやすいので使わない
    if (n.length < 2) return null
    return list.find((x) => x.name.replace(/\s|さん$/g, '') === n)?.id ?? list.find((x) => x.name.replace(/\s/g, '').includes(n) || (x.kana ?? '').replace(/\s/g, '').includes(n))?.id ?? null
  }
  const hm = /^(\d{1,2}):(\d{2})$/.exec(String(out?.start ?? ''))
  const kindMap: Record<string, string> = { 看護: 'nursing', リハビリ: 'rehab', その他: 'other' }
  const wds = Array.isArray(out?.weekdays) ? [...new Set((out!.weekdays as unknown[]).filter((w): w is number => Number.isInteger(w) && (w as number) >= 0 && (w as number) <= 6))] : []
  const ai = {
      clientId: pick(out?.client, clients),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(out?.date ?? '')) ? out!.date : null,
      start: hm && Number(hm[1]) < 24 && Number(hm[2]) < 60 ? Number(hm[1]) * 60 + Number(hm[2]) : null,
      duration: Number.isInteger(out?.duration) && (out!.duration as number) >= 5 && (out!.duration as number) <= 480 ? out!.duration : null,
      staffId: pick(out?.staff, staff),
      kind: kindMap[String(out?.kind)] ?? null,
      weekdays: wds.length ? wds : null,
      interval: out?.interval === 2 ? 2 : wds.length ? 1 : null,
      memo: typeof out?.memo === 'string' ? out.memo.slice(0, 200) : null,
  }
  // 日付・時刻の計算は規則で読み取れた値を優先し、読み取れなかった項目だけ AI の結果で補う
  const rule = parseText(input, clients, staff, day)
  const merged = Object.fromEntries(Object.entries(ai).map(([k, v]) => [k, rule[k as keyof typeof rule] ?? v]))
  if (rule.weekdays && !rule.interval) merged.interval = 1
  // 繰り返しは「毎週」「隔週」と書かれたときだけ（単発の依頼を定期にしない）
  if (!/(毎週|隔週)/.test(input)) {
    merged.weekdays = null
    merged.interval = null
  }
  return c.json({ result: merged })
})

app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

export default app
