// 確認ダイアログ（ドラッグで動かしたときの重なり確認など）。await askConfirm(...) で結果を受け取る
import type { ReactNode } from 'react'
import { create } from 'zustand'
import { Button, Sheet } from './ui'

interface Ask {
  title: string
  body?: ReactNode
  ok: string
  cancel?: string
  warn?: boolean
  resolve: (v: boolean) => void
}

const useConfirm = create<{ ask: Ask | null }>(() => ({ ask: null }))

export function askConfirm(a: Omit<Ask, 'resolve'>) {
  return new Promise<boolean>((resolve) => {
    useConfirm.getState().ask?.resolve(false)
    useConfirm.setState({ ask: { ...a, resolve } })
  })
}

export function ConfirmHost() {
  const ask = useConfirm((s) => s.ask)
  const done = (v: boolean) => {
    ask?.resolve(v)
    useConfirm.setState({ ask: null })
  }
  return (
    <Sheet
      open={!!ask}
      onClose={() => done(false)}
      label={ask?.title ?? '確認'}
      header={<h2 className="text-[18px] font-bold tracking-tight">{ask?.title}</h2>}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => done(false)}>
            {ask?.cancel ?? 'やめる'}
          </Button>
          <Button variant={ask?.warn ? 'danger' : 'primary'} className="flex-1" onClick={() => done(true)} data-autofocus>
            {ask?.ok}
          </Button>
        </div>
      }
    >
      {ask?.body}
    </Sheet>
  )
}
