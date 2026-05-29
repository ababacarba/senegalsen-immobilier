'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

type Tab = 'vente' | 'location' | 'estimer'

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: 'vente',    label: 'Acheter',  icon: '🏠' },
  { value: 'location', label: 'Louer',   icon: '🔑' },
  { value: 'estimer',  label: 'Estimer', icon: '📊' },
]

const CITIES = [
  'Dakar', 'Thiès', 'Saint-Louis', 'Ziguinchor',
  'Mbour', 'Rufisque', 'Kaolack', 'Touba',
]

export function SearchBox() {
  const router = useRouter()
  const [tab, setTab] = React.useState<Tab>('vente')
  const [query, setQuery] = React.useState('')
  const [showSuggestions, setShowSuggestions] = React.useState(false)

  const filtered = CITIES.filter(c =>
    c.toLowerCase().includes(query.toLowerCase())
  )

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (tab === 'estimer') { router.push('/estimer'); return }
    const params = new URLSearchParams()
    params.set('type', tab)
    if (query) params.set('city', query.toLowerCase())
    router.push(`/annonces?${params.toString()}`)
  }

  function selectCity(city: string) {
    setQuery(city)
    setShowSuggestions(false)
  }

  return (
    <div
      className="w-full rounded-2xl shadow-lg overflow-visible"
      style={{
        background: '#ffffff',
        border: '1px solid #e8e8e2',
        boxShadow: '0 4px 24px rgba(10,15,29,0.10)',
      }}
    >
      {/* Tabs */}
      <div
        className="flex border-b"
        style={{ borderColor: '#e8e8e2' }}
      >
        {TABS.map(t => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className="flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-colors relative"
            style={{
              color: tab === t.value ? '#0D1B3E' : '#9ca3af',
              borderBottom: tab === t.value ? '2px solid #0D1B3E' : '2px solid transparent',
              marginBottom: '-1px',
              background: 'transparent',
              cursor: 'pointer',
            } as React.CSSProperties}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Champ de recherche */}
      <form onSubmit={handleSearch} className="p-4">
        <div className="relative flex items-center gap-3">
          {/* Input */}
          <div className="relative flex-1">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4"
              style={{ color: '#9ca3af' }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setShowSuggestions(true) }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder={tab === 'estimer' ? 'Adresse du bien à estimer' : 'Saisir une ville, un quartier...'}
              className="w-full rounded-xl border px-10 py-3.5 text-sm outline-none transition-all"
              style={{
                border: '1.5px solid #e8e8e2',
                color: '#0D1B3E',
                background: '#fafaf8',
              }}
              onFocusCapture={e => {
                (e.target as HTMLInputElement).style.borderColor = '#0D1B3E'
                ;(e.target as HTMLInputElement).style.background = '#ffffff'
              }}
              onBlurCapture={e => {
                (e.target as HTMLInputElement).style.borderColor = '#e8e8e2'
                ;(e.target as HTMLInputElement).style.background = '#fafaf8'
              }}
            />

            {/* Suggestions */}
            {showSuggestions && query.length > 0 && filtered.length > 0 && (
              <ul
                className="absolute top-full left-0 right-0 mt-1 rounded-xl shadow-lg z-50 overflow-hidden"
                style={{ background: '#ffffff', border: '1px solid #e8e8e2' }}
              >
                {filtered.map(city => (
                  <li key={city}>
                    <button
                      type="button"
                      onClick={() => selectCity(city)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors hover:bg-gray-50"
                      style={{ color: '#374151' }}
                    >
                      <svg className="h-3.5 w-3.5 shrink-0" style={{ color: '#9ca3af' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                      </svg>
                      {city}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Bouton */}
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-3.5 text-sm font-semibold text-white rounded-xl transition-opacity hover:opacity-90 shrink-0"
            style={{ background: '#0D1B3E' }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            Rechercher
          </button>
        </div>
      </form>
    </div>
  )
}
