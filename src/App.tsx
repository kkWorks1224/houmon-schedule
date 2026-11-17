import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CalendarDays, HardDrive, Plus, Repeat, Settings, Users } from 'lucide-react'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { ConfirmHost } from './components/confirm'
import { Button, cx, Skeleton, Toaster } from './components/ui'
import { Editor } from './features/editor/Editor'
import { openEditor, useEditor } from './features/editor/state'
import { Schedule } from './features/schedule/Schedule'
// 最初に開くスケジュール以外の画面は必要になってから読み込む
const SeriesPage = lazy(() => import('./features/series/SeriesPage').then((m) => ({ default: m.SeriesPage })))
const ClientsPage = lazy(() => import('./features/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
import { boot, startDemo, useApp, type Tab } from './store/app'

export const STATION = '○○訪問看護ステーション'

export function App() {
  const phase = useApp((s) => s.phase)
  useEffect(() => {
    void boot()
  }, [])
  useEffect(() => {
    if (phase !== 'checking') document.getElementById('boot')?.remove()
  }, [phase])
  return (
    <>
      {phase === 'login' ? <Login /> : phase === 'notMember' ? <NotMember /> : phase === 'error' ? <BootError /> : phase === 'ready' ? <Shell /> : <AppSkeleton />}
      <Toaster />
    </>
  )
}

const NAV: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'schedule', label: 'スケジュール', icon: <CalendarDays size={22} strokeWidth={2} /> },
  { tab: 'series', label: '定期訪問', icon: <Repeat size={22} strokeWidth={2} /> },
  { tab: 'clients', label: '利用者', icon: <Users size={22} strokeWidth={2} /> },
  { tab: 'settings', label: '設定', icon: <Settings size={22} strokeWidth={2} /> },
]

function Shell() {
  const tab = useApp((s) => s.tab)
  const date = useApp((s) => s.date)
  const isDemo = useApp((s) => s.repo?.kind === 'local')
  const go = (t: Tab) => useApp.setState({ tab: t })
  const add = () => {
    const f = useApp.getState().staffFilter
    openEditor({ mode: 'new', date, staffId: f === 'all' ? undefined : f })
  }

  // キーボード：N 新規 / 1〜4 画面切替（入力中・シート表示中は無効）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || useEditor.getState().init) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        add()
      }
      const m = /^Digit([1-4])$/.exec(e.code)
      if (e.shiftKey && m) go(NAV[Number(m[1]) - 1].tab)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only z-[90] rounded-full bg-accent px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        本文へ移動
      </a>
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-white/70 px-3 py-5 lg:flex">
        <div className="mb-5 px-3">
          <p className="text-[15px] leading-tight font-bold tracking-tight">{STATION}</p>
          <p className="mt-1 text-[12.5px] text-ink-3">訪問スケジュール</p>
        </div>
        <Button size="md" icon={<Plus size={18} strokeWidth={2.4} />} onClick={add} className="mx-1 mb-4" title="予定を追加（N）">
          予定を追加
        </Button>
        <nav aria-label="画面" className="flex flex-col gap-0.5">
          {NAV.map((n, i) => (
            <button key={n.tab} onClick={() => go(n.tab)} aria-current={tab === n.tab ? 'page' : undefined} title={`${n.label}（Shift+${i + 1}）`} className={cx('press relative flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-[15px] font-semibold', tab === n.tab ? 'text-accent-ink' : 'text-ink-2 hover:bg-black/[0.04]')}>
              {tab === n.tab && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-accent-soft" transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }} />}
              <span className="relative flex">{n.icon}</span>
              <span className="relative">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto px-3 text-[12px] leading-relaxed text-ink-3">
          {isDemo ? (
            <p className="flex gap-1.5">
              <HardDrive size={14} className="mt-0.5 shrink-0" aria-hidden />
              デモ：この端末のブラウザにだけ保存。ほかの端末とは同期しません
            </p>
          ) : (
            <p>キーボード：N 追加／T 今日／← → 移動／D・W 日・週</p>
          )}
        </div>
      </aside>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
            <Suspense fallback={<PageSkeleton />}>{tab === 'schedule' ? <Schedule /> : tab === 'series' ? <SeriesPage /> : tab === 'clients' ? <ClientsPage /> : <SettingsPage />}</Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* スマホ：浮かぶガラスのタブバーと追加ボタン */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-end gap-2.5 px-3 pb-[max(10px,env(safe-area-inset-bottom))] lg:hidden">
        <nav aria-label="画面" className="glass pointer-events-auto flex h-[62px] flex-1 items-center justify-around rounded-full px-1.5">
          {NAV.map((n) => {
            const on = tab === n.tab
            return (
              <button key={n.tab} onClick={() => go(n.tab)} aria-current={on ? 'page' : undefined} className={cx('press relative flex h-[52px] min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-semibold', on ? 'text-accent' : 'text-ink-2')}>
                {on && <motion.span layoutId="tab-active" className="absolute inset-0 rounded-full bg-black/[0.06]" transition={{ type: 'spring', duration: 0.38, bounce: 0.2 }} />}
                <span className="relative flex">{n.icon}</span>
                <span className="relative">{n.label}</span>
              </button>
            )
          })}
        </nav>
        <motion.button whileTap={{ scale: 0.9 }} transition={{ type: 'spring', duration: 0.3, bounce: 0.4 }} onClick={add} aria-label="予定を追加" className="pointer-events-auto flex h-[62px] w-[62px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_24px_rgb(10_108_224/0.4),inset_0_1px_0_rgb(255_255_255/0.35)]">
          <Plus size={28} strokeWidth={2.5} />
        </motion.button>
      </div>

      <Editor />
      <ConfirmHost />
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+14px)] lg:px-8 lg:pt-6" aria-busy="true" aria-label="読み込み中">
      <Skeleton className="mb-4 h-8 w-40" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="mb-2.5 h-[72px] rounded-[16px]" />
      ))}
    </div>
  )
}

/** アプリの骨組みを模した全画面スケルトン（読み込み中） */
export function AppSkeleton() {
  return (
    <div className="min-h-dvh lg:flex" aria-busy="true" aria-label="読み込み中">
      <aside className="hidden h-dvh w-[232px] shrink-0 flex-col gap-2 border-r border-line bg-white/70 px-5 py-5 lg:flex">
        <Skeleton className="mb-1 h-5 w-40" />
        <Skeleton className="mb-5 h-3.5 w-24" />
        <Skeleton className="mb-4 h-11 w-full rounded-full" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </aside>
      <div className="w-full px-4 pt-[calc(env(safe-area-inset-top)+12px)] lg:px-8 lg:pt-6">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        <div className="mb-2 grid grid-cols-7 gap-1.5 lg:hidden">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-[54px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mb-4 h-9 w-full rounded-full lg:w-96" />
        <div className="flex flex-col gap-2.5 lg:hidden">
          <Skeleton className="mb-2 h-[76px] rounded-[20px]" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-[18px]" />
          ))}
        </div>
        <div className="hidden grid-cols-3 gap-3 lg:grid">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[70dvh] rounded-[18px]" />
          ))}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 flex gap-2.5 px-3 pb-[max(10px,env(safe-area-inset-bottom))] lg:hidden">
        <Skeleton className="h-[62px] flex-1 rounded-full" />
        <Skeleton className="h-[62px] w-[62px] rounded-full" />
      </div>
    </div>
  )
}

const G = (
  <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
)

function CenterCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <motion.div className="surface w-full max-w-[400px] px-6 py-8 text-center" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', duration: 0.55, bounce: 0.2 }}>
        {children}
      </motion.div>
    </main>
  )
}

function Login() {
  const err = new URLSearchParams(location.search).get('auth') === 'error'
  return (
    <CenterCard>
      <h1 className="text-[21px] font-bold tracking-tight">{STATION}</h1>
      <p className="mt-1 mb-7 text-[14px] text-ink-3">訪問スケジュール</p>
      <a href="/auth/login" className="press glass flex h-[52px] w-full items-center justify-center gap-3 rounded-full text-[16px] font-semibold text-ink">
        {G}
        Google でログイン
      </a>
      {err && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl bg-bad-soft px-4 py-3 text-left text-[14px] text-bad">
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
          ログインできませんでした。もう一度お試しください。
        </p>
      )}
      <div className="my-6 h-px bg-line" />
      <Button variant="secondary" className="w-full" onClick={startDemo}>
        ログインせずにデモで試す
      </Button>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">デモの予定はこの端末のブラウザにだけ保存され、ほかの端末とは同期しません。データはすべて架空です。</p>
    </CenterCard>
  )
}

function NotMember() {
  const user = useApp((s) => s.user)
  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST' })
    location.replace('/')
  }
  return (
    <CenterCard>
      <h1 className="text-[19px] font-bold">利用登録されていないアカウントです</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
        <span className="font-semibold break-all">{user?.email}</span>
        <br />
        管理者に、設定画面の「利用するアカウント」へこのメールアドレスを追加するよう依頼してください。
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="secondary" onClick={logout}>
          別のアカウントでログイン
        </Button>
        <Button variant="ghost" onClick={startDemo}>
          デモで試す
        </Button>
      </div>
    </CenterCard>
  )
}

function BootError() {
  const msg = useApp((s) => s.bootError)
  return (
    <CenterCard>
      <AlertCircle size={32} className="mx-auto mb-3 text-bad" aria-hidden />
      <h1 className="text-[18px] font-bold">予定を読み込めませんでした</h1>
      <p className="mt-2 text-[14px] text-ink-2">{msg}</p>
      <Button className="mt-6 w-full" onClick={() => void boot()}>
        再読み込み
      </Button>
    </CenterCard>
  )
}
