import { MapLinks } from '../../components/MapLinks'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { hhmm, hm, parseHm, todayJST } from '../../../shared/date'
import { AppError, KIND_LABEL, type Client, type Kind } from '../../../shared/types'
import { Button, cx, Field, inputCls, KindTag, Segmented, Sheet, StaffMark, StaffTag, toast } from '../../components/ui'
import { errMessage } from '../../lib/repo'
import { afterChange, repo, staffById, useApp } from '../../store/app'
import { openEditor } from '../editor/state'
import { PageHeader } from '../series/SeriesPage'

export function ClientsPage() {
  const clients = useApp((s) => s.meta.clients)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Partial<Client> | null>(null)
  const norm = (s: string) => s.replace(/\s/g, '')
  const list = clients.filter((c) => !q || norm(c.name).includes(norm(q)) || norm(c.kana).includes(norm(q))).sort((a, b) => Number(b.active) - Number(a.active) || a.kana.localeCompare(b.kana, 'ja'))
  return (
    <div>
      <PageHeader
        title="利用者"
        action={
          <Button size="sm" icon={<Plus size={16} strokeWidth={2.5} />} onClick={() => setEdit({ defaultDuration: 60, defaultKind: 'nursing', active: true })}>
            利用者を追加
          </Button>
        }
      />
      <div className="px-4 pt-3 lg:px-8">
        <label className="relative mb-3 flex max-w-md items-center">
          <Search size={17} className="pointer-events-none absolute left-3.5 text-ink-3" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・ふりがなで検索" aria-label="利用者を検索" className={cx(inputCls(), 'pl-10')} />
        </label>
        <p className="mb-3 text-[13px] text-ink-3">標準の訪問時間・内容・担当者は、予定を追加するときに自動で入力されます。架空のデータです。</p>
        <ul className="grid gap-2 lg:grid-cols-2">
          {list.map((c) => (
            <li key={c.id}>
              <div className={cx('surface flex items-center gap-2 p-1.5', !c.active && 'opacity-55')}>
                <button type="button" onClick={() => setEdit(c)} className="press hover-lift flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[12px] px-2 py-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-bold">
                      {c.name}さん{!c.active && <span className="ml-2 text-[12px] font-semibold text-ink-3">休止中</span>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-2">
                      <span className="num">
                        {c.defaultStart != null ? `${hm(c.defaultStart)}〜` : ''}
                        {c.defaultDuration}分
                      </span>
                      <KindTag kind={c.defaultKind} full />
                      <StaffTag staff={staffById(c.defaultStaffId)} />
                    </span>
                    {c.address?.trim() && <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{c.address}</span>}
                  </span>
                </button>
                {c.active && (
                  <Button variant="tinted" size="sm" icon={<Plus size={15} />} onClick={() => openEditor({ mode: 'new', date: useApp.getState().date || todayJST(), clientId: c.id })} aria-label={`${c.name}さんの予定を追加`}>
                    予定
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <ClientSheet client={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

function ClientSheet({ client, onClose }: { client: Partial<Client> | null; onClose: () => void }) {
  const staff = useApp((s) => s.meta.staff)
  const [v, setV] = useState<Partial<Client>>({})
  const [err, setErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [seen, setSeen] = useState<Partial<Client> | null>(null)
  if (client !== seen) {
    setSeen(client)
    setV(client ? { defaultStaffId: staff[0]?.id, ...client } : {})
    setErr({})
  }
  const save = async () => {
    if (!v.name?.trim()) return setErr({ name: '氏名を入力してください' })
    setBusy(true)
    try {
      await repo().call('saveClient', v as Client)
      await afterChange()
      toast(`保存しました：${v.name}さん`)
      onClose()
    } catch (e) {
      if (e instanceof AppError && e.detail) setErr(e.detail as Record<string, string>)
      toast(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={!!client}
      onClose={onClose}
      label="利用者"
      header={<h2 className="text-[19px] font-bold">{v.id ? '利用者を編集' : '利用者を追加'}</h2>}
      footer={
        <Button size="lg" className="w-full" onClick={() => void save()} disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </Button>
      }
    >
      <form className="flex flex-col gap-4 pt-1" onSubmit={(e) => (e.preventDefault(), void save())} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="氏名" htmlFor="c-name" error={err.name}>
            <input id="c-name" data-autofocus value={v.name ?? ''} onChange={(e) => (setV({ ...v, name: e.target.value }), setErr({}))} className={inputCls(err.name)} aria-invalid={!!err.name} autoComplete="off" />
          </Field>
          <Field label="ふりがな" htmlFor="c-kana">
            <input id="c-kana" value={v.kana ?? ''} onChange={(e) => setV({ ...v, kana: e.target.value })} className={inputCls()} autoComplete="off" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="標準の所要時間（分）" htmlFor="c-dur" error={err.defaultDuration}>
            <input id="c-dur" type="number" min={5} max={480} step={5} value={v.defaultDuration ?? ''} onChange={(e) => setV({ ...v, defaultDuration: Number(e.target.value) })} className={cx(inputCls(err.defaultDuration), 'num font-bold')} />
          </Field>
          <Field label="標準の開始時刻（任意）" htmlFor="c-start" error={err.defaultStart}>
            <input id="c-start" type="time" step={300} value={v.defaultStart != null ? hhmm(v.defaultStart) : ''} onChange={(e) => setV({ ...v, defaultStart: parseHm(e.target.value) })} className={cx(inputCls(err.defaultStart), 'num font-bold')} />
          </Field>
        </div>
        <Field label="標準の担当者">
          <Segmented label="標準の担当者" value={v.defaultStaffId ?? ''} onChange={(s) => setV({ ...v, defaultStaffId: s })} options={staff.map((s) => ({ value: s.id, label: <><StaffMark staff={s} size={18} /><span className="truncate">{s.name}</span></> }))} />
        </Field>
        <Field label="標準の訪問内容">
          <Segmented label="標準の訪問内容" value={v.defaultKind ?? 'nursing'} onChange={(k: Kind) => setV({ ...v, defaultKind: k })} options={(['nursing', 'rehab', 'other'] as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        </Field>
        <Field label="住所（任意）" htmlFor="c-addr" hint="「地図」「経路」で Google マップを開くために使います。地図を開いたとき、住所が端末から Google に送られます。">
          <input id="c-addr" value={v.address ?? ''} onChange={(e) => setV({ ...v, address: e.target.value })} maxLength={200} placeholder="例：山梨県甲府市丸の内1丁目" className={inputCls()} autoComplete="off" />
        </Field>
        <MapLinks address={v.address ?? ''} size="sm" className="-mt-2" />
        <Field label="メモ（訪問時の注意など。医療記録は入力しないでください）" htmlFor="c-memo">
          <input id="c-memo" value={v.memo ?? ''} onChange={(e) => setV({ ...v, memo: e.target.value })} maxLength={500} className={inputCls()} />
        </Field>
        {v.id && (
          <Field label="状態">
            <Segmented label="状態" value={v.active === false ? 'off' : 'on'} onChange={(x) => setV({ ...v, active: x === 'on' })} options={[{ value: 'on', label: '利用中' }, { value: 'off', label: '休止（選択肢に出さない）' }]} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
