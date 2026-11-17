import { MapPin, Navigation } from 'lucide-react'
import { mapUrl, routeUrl } from '../lib/maps'
import { cx } from './ui'

/** 「地図」「経路」ボタン（Google マップを新しいタブ／アプリで開く） */
export function MapLinks({ address, name, size = 'md', className }: { address: string; name?: string; size?: 'sm' | 'md'; className?: string }) {
  if (!address?.trim()) return null
  const cls = cx('press inline-flex shrink-0 items-center justify-center gap-1 rounded-full font-semibold', size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-[14.5px]')
  const who = name ? `${name}さんの` : ''
  return (
    <span className={cx('flex flex-wrap gap-2', className)}>
      <a href={mapUrl(address)} target="_blank" rel="noopener noreferrer" className={cx(cls, 'bg-black/[0.055] text-ink')} aria-label={`${who}家の場所を地図で開く（Google マップ）`} onClick={(e) => e.stopPropagation()}>
        <MapPin size={size === 'sm' ? 15 : 17} aria-hidden />
        地図
      </a>
      <a href={routeUrl(address)} target="_blank" rel="noopener noreferrer" className={cx(cls, 'bg-accent text-white')} aria-label={`現在地から${who}家までの経路を開く（Google マップ）`} onClick={(e) => e.stopPropagation()}>
        <Navigation size={size === 'sm' ? 14 : 16} aria-hidden />
        経路
      </a>
    </span>
  )
}

/** 予定カードに重ねる小さな経路ボタン */
export function RouteIcon({ address, name, className }: { address: string; name: string; className?: string }) {
  if (!address?.trim()) return null
  return (
    <a
      href={routeUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`現在地から${name}さんの家までの経路を開く（Google マップ）`}
      title="経路を開く（Google マップ）"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cx('press flex h-9 items-center gap-1 rounded-full bg-accent-soft pr-3 pl-2.5 text-[13px] font-bold text-accent-ink', className)}
    >
      <Navigation size={14} aria-hidden />
      経路
    </a>
  )
}
