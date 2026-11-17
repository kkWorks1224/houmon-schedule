import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, useTransform, type PanInfo } from 'motion/react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { create } from 'zustand'
import { KIND_LABEL, KIND_SHORT, type Kind, type Staff } from '../../shared/types'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')
export const spring = { type: 'spring' as const, duration: 0.42, bounce: 0.18 }
/** マウス・トラックパッドの端末か（スマホでは入力欄へ自動でフォーカスせず、キーボードで画面を隠さない） */
export const finePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches

// ---------- ボタン ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'tinted'
const V: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-ink disabled:bg-ink-3/40 shadow-[0_1px_2px_rgb(10_108_224/0.3)]',
  secondary: 'bg-surface text-ink ring-1 ring-line-strong hover:bg-sunken disabled:text-ink-3',
  tinted: 'bg-accent-soft text-accent-ink hover:bg-[#d8e7fc] disabled:opacity-50',
  ghost: 'bg-transparent text-accent hover:bg-accent-soft/70 disabled:text-ink-3',
  danger: 'bg-bad-soft text-bad hover:bg-[#fadcd8] disabled:opacity-50',
}
const S = { sm: 'h-9 px-3 text-[14px] gap-1.5 rounded-full', md: 'h-11 px-4 text-[15px] gap-2 rounded-full', lg: 'h-[52px] px-6 text-[16px] gap-2 rounded-full' }

export function Button({ variant = 'primary', size = 'md', icon, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof S; icon?: ReactNode }) {
  return (
    <button type="button" {...rest} className={cx('press inline-flex cursor-pointer select-none items-center justify-center font-semibold whitespace-nowrap disabled:cursor-not-allowed', V[variant], S[size], className)}>
      {icon}
      {children}
    </button>
  )
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={cx('press inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05] disabled:opacity-40', className)}>
      {children}
    </button>
  )
}

// ---------- 担当者・訪問内容の表示（色＋文字） ----------
const ST = [
  { fg: 'text-st1', bg: 'bg-st1', soft: 'bg-st1-soft', ring: 'ring-st1/30', bar: 'before:bg-st1' },
  { fg: 'text-st2', bg: 'bg-st2', soft: 'bg-st2-soft', ring: 'ring-st2/30', bar: 'before:bg-st2' },
  { fg: 'text-st3', bg: 'bg-st3', soft: 'bg-st3-soft', ring: 'ring-st3/30', bar: 'before:bg-st3' },
]
export const staffTone = (s: Staff | undefined) => ST[((s?.sort ?? 1) - 1 + ST.length) % ST.length]

export function StaffMark({ staff, size = 22 }: { staff: Staff | undefined; size?: number }) {
  const t = staffTone(staff)
  return (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white', t.bg)} style={{ width: size, height: size, fontSize: size * 0.52 }}>
      {staff?.mark ?? '?'}
    </span>
  )
}

export function StaffTag({ staff }: { staff: Staff | undefined }) {
  const t = staffTone(staff)
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 text-[12.5px] font-semibold', t.soft, t.fg)}>
      <StaffMark staff={staff} size={18} />
      {staff?.name ?? '未設定'}
    </span>
  )
}

const KIND_STYLE: Record<Kind, string> = { nursing: 'text-ink-2 ring-ink-3/40', rehab: 'text-[#7a4a00] ring-[#c58a2a]/60 bg-[#fff6e6]', other: 'text-ink-3 ring-ink-3/30 border-dashed' }
export function KindTag({ kind, full }: { kind: Kind; full?: boolean }) {
  return (
    <span className={cx('inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-md px-1 text-[11.5px] font-bold ring-1', KIND_STYLE[kind])} title={KIND_LABEL[kind]}>
      {full ? KIND_LABEL[kind] : KIND_SHORT[kind]}
      {!full && <span className="sr-only">（{KIND_LABEL[kind]}）</span>}
    </span>
  )
}

// ---------- セグメント（選択中の背景がすべって動く） ----------
export function Segmented<T extends string | number>({ value, options, onChange, label, size = 'md', className }: { value: T; options: { value: T; label: ReactNode; aria?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; className?: string }) {
  const id = useId()
  return (
    <div role="radiogroup" aria-label={label} className={cx('relative flex rounded-full bg-black/[0.055] p-[3px]', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.aria}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              e.preventDefault()
              const i = options.findIndex((x) => x.value === value)
              const n = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]
              onChange(n.value)
              ;(e.currentTarget.parentElement?.querySelectorAll('button')[options.indexOf(n)] as HTMLElement | undefined)?.focus()
            }}
            tabIndex={on ? 0 : -1}
            className={cx('relative z-10 flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors', size === 'sm' ? 'h-8 px-3 text-[13.5px]' : 'h-10 px-3 text-[15px]', on ? 'text-ink' : 'text-ink-2 hover:text-ink')}
          >
            {on && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 -z-10 rounded-full bg-white shadow-[0_1px_3px_rgb(15_23_42/0.14),0_0_0_0.5px_rgb(15_23_42/0.06)]" transition={{ type: 'spring', duration: 0.34, bounce: 0.15 }} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------- スケルトン ----------
export const Skeleton = ({ className, style }: { className?: string; style?: React.CSSProperties }) => <div className={cx('skeleton', className)} style={style} aria-hidden />

// ---------- シート（スマホは下から。下にスワイプで閉じる／PC は中央） ----------
export function Sheet({ open, onClose, label, children, header, footer, wide }: { open: boolean; onClose: () => void; label: string; children: ReactNode; header?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const reduce = useReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  const controls = useDragControls()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current()
      // フォーカスをシートの中に閉じ込める
      if (e.key === 'Tab' && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]')].filter((x) => x.offsetParent !== null)
        if (!f.length) return
        if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f[f.length - 1].focus())
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) (e.preventDefault(), f[0].focus())
      }
    }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => {
      const p = panel.current
      if (!finePointer()) return p?.focus({ preventScroll: true })
      ;(p?.querySelector<HTMLElement>('[data-autofocus]') ?? p?.querySelector<HTMLElement>('input, select, textarea, button'))?.focus({ preventScroll: true })
    }, 40)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
      document.body.style.overflow = ''
      prev?.focus?.({ preventScroll: true })
    }
  }, [open])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose()
  }
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center lg:p-6" role="dialog" aria-modal="true" aria-label={label}>
          <motion.div className="absolute inset-0 bg-[#0f172a]/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }} transition={{ duration: 0.22 }} onClick={onClose} />
          <motion.div
            ref={panel}
            tabIndex={-1}
            className={cx('relative flex max-h-[94dvh] outline-none w-full flex-col overflow-hidden rounded-t-[28px] bg-white/95 shadow-lift ring-1 ring-black/5 backdrop-blur-xl lg:max-h-[88dvh] lg:rounded-[28px]', wide ? 'lg:max-w-3xl' : 'lg:max-w-[560px]')}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%', transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            drag={reduce ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.6 }}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDragEnd}
          >
            <div className="touch-none" onPointerDown={(e) => !reduce && controls.start(e)}>
              <div className="flex cursor-grab justify-center pt-2 pb-0.5 lg:hidden" aria-hidden>
                <span className="h-[5px] w-9 rounded-full bg-ink/15" />
              </div>
              <div className="flex items-start justify-between gap-2 px-5 pt-1 pb-2 lg:pt-4">
                <div className="min-w-0 flex-1">{header}</div>
                <IconButton label="閉じる（Esc）" onClick={onClose} className="-mt-1 -mr-2 bg-black/[0.05]">
                  <X size={19} />
                </IconButton>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
            {footer && <div className="border-t border-line bg-white/80 px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ---------- トースト ----------
type Tone = 'ok' | 'error' | 'info'
interface ToastItem { id: number; text: string; tone: Tone; action?: { label: string; run: () => void } }
let tid = 0
const useToast = create<{ items: ToastItem[] }>(() => ({ items: [] }))
export function toast(text: string, tone: Tone = 'ok', action?: ToastItem['action']) {
  const id = ++tid
  useToast.setState((s) => ({ items: [...s.items.slice(-2), { id, text, tone, action }] }))
  setTimeout(() => useToast.setState((s) => ({ items: s.items.filter((i) => i.id !== id) })), action ? 6000 : tone === 'error' ? 6000 : 3000)
}
export function Toaster() {
  const items = useToast((s) => s.items)
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-[80] flex flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', duration: 0.45, bounce: 0.2 }}
            className="glass pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full py-2.5 pr-2.5 pl-4 text-[14.5px] font-medium text-ink"
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            {t.tone === 'ok' ? <CheckCircle2 size={19} className="shrink-0 text-ok" aria-hidden /> : t.tone === 'error' ? <AlertCircle size={19} className="shrink-0 text-bad" aria-hidden /> : <Info size={19} className="shrink-0 text-accent" aria-hidden />}
            <span className="leading-snug">{t.text}</span>
            {t.action ? (
              <button
                className="press ml-1 shrink-0 cursor-pointer rounded-full bg-accent-soft px-3 py-1.5 text-[13.5px] font-semibold text-accent-ink"
                onClick={() => {
                  t.action!.run()
                  useToast.setState((s) => ({ items: s.items.filter((i) => i.id !== t.id) }))
                }}
              >
                {t.action.label}
              </button>
            ) : (
              <span className="w-1.5" />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ---------- フリック（右＝主な操作、左＝もう一方。ボタンでも同じ操作ができる） ----------
export type FlickAction = { label: string; icon: ReactNode; color: string; run: () => void }
export const haptic = (ms = 8) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* noop */
  }
}
export function Flick({ right, left, children, className }: { right?: FlickAction; left?: FlickAction; children: ReactNode; className?: string }) {
  const x = useMotionValue(0)
  const ref = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState<'r' | 'l' | null>(null)
  const w = () => ref.current?.offsetWidth ?? 340
  const th = () => Math.min(96, w() * 0.26)
  const rOp = useTransform(x, [0, 24], [0, 1])
  const lOp = useTransform(x, [-24, 0], [1, 0])
  const rScale = useTransform(x, (v) => (v > th() ? 1.18 : 0.7 + Math.min(1, v / th()) * 0.3))
  const lScale = useTransform(x, (v) => (-v > th() ? 1.18 : 0.7 + Math.min(1, -v / th()) * 0.3))
  // フリックした直後のクリック（指・マウスを離したとき）で編集画面が開かないようにする
  const dragged = useRef(false)
  const onDrag = (_: unknown, i: PanInfo) => {
    if (Math.abs(i.offset.x) > 6) dragged.current = true
    const a = i.offset.x > th() && right ? 'r' : i.offset.x < -th() && left ? 'l' : null
    if (a !== armed) {
      if (a) haptic()
      setArmed(a)
    }
  }
  const onEnd = (_: unknown, i: PanInfo) => {
    setArmed(null)
    const go = (dir: 1 | -1, act: FlickAction) => {
      haptic(14)
      void animate(x, dir * (w() + 24), { type: 'spring', duration: 0.3, bounce: 0 }).then(() => {
        act.run()
        x.set(-dir * 12)
        void animate(x, 0, { type: 'spring', duration: 0.4, bounce: 0.3 })
      })
    }
    if (right && (i.offset.x > th() || (i.velocity.x > 600 && i.offset.x > 28))) return go(1, right)
    if (left && (i.offset.x < -th() || (i.velocity.x < -600 && i.offset.x < -28))) return go(-1, left)
    void animate(x, 0, { type: 'spring', duration: 0.42, bounce: 0.28 })
  }
  return (
    <div
      ref={ref}
      className={cx('relative overflow-hidden rounded-[18px]', className)}
      style={{ touchAction: 'pan-y' }}
      onPointerDown={() => (dragged.current = false)}
      onClickCapture={(e) => {
        if (dragged.current) {
          e.preventDefault()
          e.stopPropagation()
          dragged.current = false
        }
      }}
    >
      {right && (
        <motion.div style={{ opacity: rOp, background: right.color }} className="absolute inset-0 flex items-center gap-2 pl-5 text-[14px] font-bold text-white" aria-hidden>
          <motion.span style={{ scale: rScale }} className="flex">
            {right.icon}
          </motion.span>
          {right.label}
        </motion.div>
      )}
      {left && (
        <motion.div style={{ opacity: lOp, background: left.color }} className="absolute inset-0 flex flex-row-reverse items-center gap-2 pr-5 text-[14px] font-bold text-white" aria-hidden>
          <motion.span style={{ scale: lScale }} className="flex">
            {left.icon}
          </motion.span>
          {left.label}
        </motion.div>
      )}
      <motion.div style={{ x }} drag={right || left ? 'x' : false} dragDirectionLock dragConstraints={{ left: left ? -10000 : 0, right: right ? 10000 : 0 }} dragElastic={{ left: left ? 0 : 0.06, right: right ? 0 : 0.06 }} dragMomentum={false} onDrag={onDrag} onDragEnd={onEnd} className="relative">
        {children}
      </motion.div>
    </div>
  )
}

// ---------- 入力欄 ----------
export function Field({ label, error, hint, children, htmlFor, className }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p key="e" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} id={htmlFor ? `${htmlFor}-err` : undefined} role="alert" className="mt-1.5 flex items-center gap-1 text-[13px] font-medium text-bad">
            <AlertCircle size={14} aria-hidden />
            {error}
          </motion.p>
        ) : hint ? (
          <p className="mt-1.5 text-[12.5px] text-ink-3">{hint}</p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
export const inputCls = (err?: string) => cx('h-12 w-full rounded-[14px] bg-sunken px-3.5 text-[16px] text-ink outline-none ring-1 transition-shadow placeholder:text-ink-3 focus:bg-white focus:ring-2 focus:ring-accent', err ? 'ring-bad/70' : 'ring-transparent')
