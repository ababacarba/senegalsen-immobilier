import Image from 'next/image'
import Link from 'next/link'
import { formatPrice } from '@/lib/utils'

interface ListingCardProps {
  listing: {
    id: string
    title: string
    price: number | null
    surface_m2: number | null
    price_per_m2?: number | null
    city: string
    neighborhood?: string | null
    type: 'vente' | 'location'
    property_type: string
    images: string[]
    slug: string
  }
}

export function ListingCard({ listing }: ListingCardProps) {
  const imageUrl = listing.images[0] ?? null
  const priceLabel = listing.price
    ? `${formatPrice(listing.price)}${listing.type === 'location' ? '/mois' : ''}`
    : 'Prix sur demande'
  const location = listing.neighborhood
    ? `${listing.neighborhood}, ${listing.city}`
    : listing.city

  return (
    <Link
      href={`/annonces/${listing.slug}`}
      className="card-premium group flex flex-col overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{ '--tw-ring-color': '#3B82F6' } as React.CSSProperties}
    >
      {/* Image */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '4/3', background: '#f4f4f0' }}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={listing.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #eef3f8, #d4e1ef)' }}
          >
            <svg
              className="h-12 w-12"
              style={{ color: '#7aa2c8' }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
          </div>
        )}

        {/* Gradient bas */}
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: '5rem', background: 'linear-gradient(to top, rgba(10,15,29,0.5), transparent)' }}
        />

        {/* Badge type */}
        <div className="absolute left-3 top-3">
          <span
            className="inline-block px-2.5 py-1 text-xs font-semibold tracking-wide rounded"
            style={
              listing.type === 'vente'
                ? { background: '#0D1B3E', color: '#ffffff' }
                : { background: 'rgba(255,255,255,0.92)', color: '#0D1B3E' }
            }
          >
            {listing.type === 'vente' ? 'VENTE' : 'LOCATION'}
          </span>
        </div>

        {/* Prix/m² */}
        {listing.price_per_m2 && listing.type === 'vente' && (
          <div className="absolute bottom-3 right-3">
            <span
              className="inline-block px-2 py-1 text-xs font-medium rounded"
              style={{
                background: 'rgba(10,15,29,0.75)',
                color: '#F59E0B',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(212,175,55,0.2)',
              }}
            >
              {formatPrice(listing.price_per_m2)}/m²
            </span>
          </div>
        )}
      </div>

      {/* Contenu */}
      <div className="flex flex-1 flex-col p-5">
        {/* Prix */}
        <div
          className="mb-2 text-xl font-bold"
          style={{ color: '#0D1B3E', letterSpacing: '-0.02em', fontFamily: 'var(--font-jakarta)' }}
        >
          {priceLabel}
        </div>

        {/* Titre */}
        <h3
          className="mb-4 line-clamp-2 text-sm leading-snug transition-colors duration-200"
          style={{ color: '#374151', fontWeight: 500 }}
        >
          {listing.title}
        </h3>

        {/* Détails */}
        <div
          className="mt-auto flex items-center gap-4 text-xs pt-4"
          style={{ borderTop: '1px solid #e8e8e2', color: '#9ca3af' }}
        >
          {/* Localisation */}
          <span className="flex items-center gap-1.5 min-w-0">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span className="capitalize truncate font-medium" style={{ color: '#6b7280' }}>
              {location}
            </span>
          </span>

          {/* Surface */}
          {listing.surface_m2 && (
            <span className="flex items-center gap-1.5 shrink-0">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
              <span className="font-medium" style={{ color: '#6b7280' }}>{listing.surface_m2} m²</span>
            </span>
          )}

          {/* Type */}
          <span
            className="ml-auto text-xs uppercase tracking-wider shrink-0"
            style={{ color: '#d1d5db', letterSpacing: '0.08em' }}
          >
            {listing.property_type}
          </span>
        </div>
      </div>
    </Link>
  )
}
