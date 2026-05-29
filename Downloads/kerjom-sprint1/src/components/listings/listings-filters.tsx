'use client'

import { useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const CITIES = [
  { value: '', label: 'Toutes les villes' },
  { value: 'dakar', label: 'Dakar' },
  { value: 'thiès', label: 'Thiès' },
  { value: 'saint-louis', label: 'Saint-Louis' },
  { value: 'ziguinchor', label: 'Ziguinchor' },
  { value: 'mbour', label: 'Mbour' },
  { value: 'rufisque', label: 'Rufisque' },
  { value: 'kaolack', label: 'Kaolack' },
  { value: 'touba', label: 'Touba' },
]

const PROPERTY_TYPES = [
  { value: '', label: 'Tous les biens' },
  { value: 'appartement', label: 'Appartement' },
  { value: 'maison', label: 'Maison' },
  { value: 'villa', label: 'Villa' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'bureau', label: 'Bureau' },
  { value: 'commerce', label: 'Commerce' },
]

const SORT_OPTIONS = [
  { value: 'created_at_desc', label: 'Plus récentes' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
  { value: 'surface_m2_desc', label: 'Surface décroissante' },
]

interface ListingsFiltersProps {
  currentParams: {
    type?: string
    city?: string
    property_type?: string
    sort?: string
  }
  total: number
}

export function ListingsFilters({ currentParams, total }: ListingsFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()

  function updateParams(updates: Record<string, string | undefined>) {
    const merged = { ...currentParams, ...updates, page: undefined }
    const params = new URLSearchParams()
    Object.entries(merged).forEach(([key, value]) => { if (value) params.set(key, value) })
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const selectClass = cn(
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer outline-none',
    'border border-gray-200 bg-white text-gray-700',
    'hover:border-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900'
  )

  const activeType = currentParams.type ?? ''
  const hasFilters = !!(currentParams.type || currentParams.city || currentParams.property_type)

  return (
    <div
      className="rounded-2xl bg-white p-4 shadow-sm"
      style={{ border: '1px solid #e8e8e2' }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">

        {/* Tabs type */}
        <div
          className="flex rounded-xl p-1 gap-1"
          style={{ background: '#f4f4f0' }}
        >
          {[
            { value: '', label: 'Tout' },
            { value: 'vente', label: 'Acheter' },
            { value: 'location', label: 'Louer' },
          ].map(option => (
            <button
              key={option.label}
              type="button"
              onClick={() => updateParams({ type: option.value || undefined })}
              className="rounded-lg px-4 py-2 text-sm font-semibold transition-all"
              style={activeType === option.value
                ? { background: '#0D1B3E', color: '#ffffff' }
                : { background: 'transparent', color: '#6b7280' }
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Ville */}
        <select
          value={currentParams.city ?? ''}
          onChange={e => updateParams({ city: e.target.value || undefined })}
          className={selectClass}
          aria-label="Filtrer par ville"
        >
          {CITIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        {/* Type de bien */}
        <select
          value={currentParams.property_type ?? ''}
          onChange={e => updateParams({ property_type: e.target.value || undefined })}
          className={selectClass}
          aria-label="Type de bien"
        >
          {PROPERTY_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        {/* Tri */}
        <select
          value={currentParams.sort ?? 'created_at_desc'}
          onChange={e => updateParams({ sort: e.target.value })}
          className={cn(selectClass, 'sm:ml-auto')}
          aria-label="Trier"
        >
          {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {/* Reset */}
        {hasFilters && (
          <button
            type="button"
            onClick={() => router.push(pathname)}
            className="text-sm font-medium transition-colors"
            style={{ color: '#9ca3af' }}
          >
            Réinitialiser
          </button>
        )}
      </div>

      {/* Compteur */}
      <div className="mt-3 pt-3" style={{ borderTop: '1px solid #e8e8e2' }}>
        <span className="text-sm" style={{ color: '#6b7280' }}>
          <span className="font-semibold" style={{ color: '#0D1B3E' }}>
            {total.toLocaleString('fr-FR')}
          </span>{' '}
          annonce{total > 1 ? 's' : ''} trouvée{total > 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
