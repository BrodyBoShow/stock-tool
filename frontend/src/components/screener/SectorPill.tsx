import { sectorChip } from '@/lib/constants'

export function SectorPill({ sector }: { sector: string | null }) {
  if (!sector) return <span className="text-xs text-subtle">—</span>
  const { bg, fg } = sectorChip(sector)
  return (
    <span
      className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-[9px] py-0.5 text-[0.68rem] font-semibold"
      style={{ background: bg, color: fg }}
    >
      {sector}
    </span>
  )
}
