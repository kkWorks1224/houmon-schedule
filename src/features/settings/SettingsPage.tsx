import { HardDrive, LogOut, Shield, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Member } from '../../../shared/types'
import { Button, cx, Field, inputCls, Segmented, StaffMark, toast } from '../../components/ui'
import { errMessage, LocalRepo } from '../../lib/repo'
import { afterChange, leaveDemo, repo, useApp } from '../../store/app'
import { PageHeader } from '../series/SeriesPage'

export function SettingsPage() {
  const isDemo = useApp((s) => s.repo?.kind === 'local')
  const role = useApp((s) => s.role)
  return (
    <div>
      <PageHeader title="設定" />
      <div className="flex max-w-2xl flex-col gap-4 px-4 pt-4 lg:px-8">
        <Account />
        <StaffNames />
        {!isDemo && role === 'admin' && <Members />}
        <Keys />
        {!isDemo && role === 'admin' && <ClearData />}
        <p className="pb-4 text-[12px] leading-relaxed text-ink-3">試作版です。請求・記録などの機能はありません。医療情報を扱う本番運用の前に、運用規程・アクセス管理・バックアップの確認が必要です。</p>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface p-4" aria-label={title}>
      <h2 className="mb-3 text-[16px] font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Account() {
  const user = useApp((s) => s.user)
  const isDemo = useApp((s) => s.repo?.kind === 'local')
  const role = useApp((s) => s.role)
  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST' }).catch(() => {})
    location.replace('/')
  }
  return (
    <Card title="保存先とアカウント">
      {isDemo ? (
        <>
          <p className="flex items-start gap-2 text-[14px] leading-relaxed text-ink-2">
            <HardDrive size={18} className="mt-0.5 shrink-0" aria-hidden />
            デモモードです。予定はこの端末のブラウザにだけ保存され、ほかの端末とは同期しません。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => { if (confirm('デモの予定を初期状態に戻しますか？')) { LocalRepo.reset(); location.reload() } }}>
              デモを初期状態に戻す
            </Button>
            <Button size="sm" onClick={leaveDemo}>
              Google でログインして共有で使う
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[14px] text-ink-2">
            共有データベース（Cloudflare D1）に保存しています。ログイン中：<span className="font-semibold break-all text-ink">{user?.email}</span>（{role === 'admin' ? '管理者' : 'スタッフ'}）
          </p>
          <Button variant="secondary" size="sm" className="mt-3" icon={<LogOut size={16} />} onClick={() => void logout()}>
            ログアウト
          </Button>
        </>
      )}
    </Card>
  )
}

function StaffNames() {
  const staff = useApp((s) => s.meta.staff)
  const [names, setNames] = useState<Record<string, { name: string; mark: string }>>({})
  const [busy, setBusy] = useState('')
  useEffect(() => setNames(Object.fromEntries(staff.map((s) => [s.id, { name: s.name, mark: s.mark }]))), [staff])
  const save = async (id: string) => {
    setBusy(id)
    try {
      await repo().call('renameStaff', id, names[id].name, names[id].mark)
      await afterChange()
      toast('表示名を変更しました（予定との紐付けはそのままです）')
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setBusy('')
    }
  }
  return (
    <Card title="担当者の表示名">
      <p className="mb-3 text-[13px] text-ink-3">担当者は内部の固定IDで管理しているため、表示名を変えても予定との紐付けは変わりません。印は色に頼らず見分けるための1文字です。</p>
      <ul className="flex flex-col gap-2.5">
        {staff.map((s) => {
          const v = names[s.id] ?? { name: s.name, mark: s.mark }
          const dirty = v.name !== s.name || v.mark !== s.mark
          return (
            <li key={s.id} className="flex items-end gap-2">
              <StaffMark staff={{ ...s, mark: v.mark || s.mark }} size={34} />
              <Field label="表示名" htmlFor={`sn-${s.id}`} className="min-w-0 flex-1">
                <input id={`sn-${s.id}`} value={v.name} maxLength={20} onChange={(e) => setNames({ ...names, [s.id]: { ...v, name: e.target.value } })} className={inputCls()} />
              </Field>
              <Field label="印" htmlFor={`sm-${s.id}`} className="w-16">
                <input id={`sm-${s.id}`} value={v.mark} maxLength={1} onChange={(e) => setNames({ ...names, [s.id]: { ...v, mark: e.target.value } })} className={cx(inputCls(), 'text-center font-bold')} />
              </Field>
              <Button variant={dirty ? 'primary' : 'secondary'} className="h-12" disabled={!dirty || busy === s.id} onClick={() => void save(s.id)}>
                保存
              </Button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Members() {
  const me = useApp((s) => s.user?.email)
  const [list, setList] = useState<Member[] | null>(null)
  const [fixed, setFixed] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'staff' | 'admin'>('staff')
  const [err, setErr] = useState('')
  const load = async () => {
    const r = await fetch('/api/members')
    if (!r.ok) return setErr('一覧を読み込めませんでした')
    const d = (await r.json()) as { members: Member[]; fixedAdmins: string[] }
    setList(d.members)
    setFixed(d.fixedAdmins)
  }
  useEffect(() => {
    void load()
  }, [])
  const add = async () => {
    setErr('')
    const r = await fetch('/api/members', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, role }) })
    const d = (await r.json().catch(() => ({}))) as { message?: string }
    if (!r.ok) return setErr(d.message ?? '追加できませんでした')
    setEmail('')
    toast('利用するアカウントを追加しました')
    void load()
  }
  const remove = async (e: string) => {
    if (!confirm(`${e} の利用を止めますか？`)) return
    const r = await fetch(`/api/members/${encodeURIComponent(e)}`, { method: 'DELETE' })
    const d = (await r.json().catch(() => ({}))) as { message?: string }
    if (!r.ok) return toast(d.message ?? '削除できませんでした', 'error')
    void load()
  }
  return (
    <Card title="利用するアカウント（管理者のみ）">
      <p className="mb-3 flex gap-1.5 text-[13px] text-ink-3">
        <Shield size={15} className="mt-0.5 shrink-0" aria-hidden />
        ここに登録した Google アカウントだけが予定を見たり変更したりできます（サーバ側で確認しています）。
      </p>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => (e.preventDefault(), void add())} noValidate>
        <Field label="メールアドレス" htmlFor="m-email" error={err} className="flex-1">
          <input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={inputCls(err)} autoComplete="off" spellCheck={false} />
        </Field>
        <Segmented size="sm" label="権限" value={role} onChange={setRole} options={[{ value: 'staff', label: 'スタッフ' }, { value: 'admin', label: '管理者' }]} className="sm:mb-2 sm:w-48" />
        <Button type="submit" className="h-12" disabled={!email}>
          追加
        </Button>
      </form>
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {fixed.map((e) => (
          <li key={e} className="flex items-center gap-2 py-2 text-[14px]">
            <span className="min-w-0 flex-1 truncate">{e}</span>
            <span className="text-[12px] text-ink-3">管理者（サーバ設定）</span>
          </li>
        ))}
        {list?.map((m) => (
          <li key={m.email} className="flex items-center gap-2 py-2 text-[14px]">
            <span className="min-w-0 flex-1 truncate">{m.email}</span>
            <span className="text-[12px] text-ink-3">{m.role === 'admin' ? '管理者' : 'スタッフ'}</span>
            {m.email !== me && (
              <button type="button" aria-label={`${m.email}を削除`} onClick={() => void remove(m.email)} className="press flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-bad hover:bg-bad-soft">
                <Trash2 size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ClearData() {
  const [text, setText] = useState('')
  const run = async () => {
    const r = await fetch('/api/admin/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: text }) })
    const d = (await r.json().catch(() => ({}))) as { message?: string }
    if (!r.ok) return toast(d.message ?? '削除できませんでした', 'error')
    toast('架空のデータを削除しました')
    setText('')
    await afterChange()
  }
  return (
    <Card title="架空のデモデータを削除">
      <p className="mb-3 text-[13px] text-ink-3">試用が終わったら、架空の利用者・予定・週間予定をすべて削除できます（担当者とアカウントは残ります）。元に戻せません。</p>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="「すべて削除」と入力" aria-label="確認の文字" className={inputCls()} />
        <Button variant="danger" className="h-12" disabled={text !== 'すべて削除'} onClick={() => void run()}>
          削除
        </Button>
      </div>
    </Card>
  )
}

function Keys() {
  const rows = [
    ['N', '予定を追加'],
    ['T', '今日へ'],
    ['← / →', '前・次の日（週）'],
    ['D / W', '日表示・週表示'],
    ['1〜4', '全員・担当者で絞り込み'],
    ['/', '利用者名で検索'],
    ['Enter', '入力画面で保存'],
    ['Ctrl/⌘+Shift+Enter', '保存して続けて追加'],
    ['Esc', '入力画面を閉じる'],
  ]
  return (
    <Card title="キーボード操作（PC）">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="num rounded-md bg-sunken px-1.5 py-0.5 text-[12.5px] font-bold ring-1 ring-line">{k}</kbd>
            </dt>
            <dd className="text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
