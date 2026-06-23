import { sectorPillColors } from '@/lib/constants'

export function SectorPill({ sector }: { sector: string | null }) {
  if (!sector) return <span className="text-xs text-gray-400">—</span>
  const [bg, fg] = sectorPillColors(sector)
  return (
    <span
      className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-[9px] py-0.5 text-[0.68rem] font-semibold"
      style={{ background: bg, color: fg }}
    >
      {sector}
    </span>
  )
}
