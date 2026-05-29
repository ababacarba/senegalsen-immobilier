import type { Metadata } from 'next'
import Link from 'next/link'
import { getListings, type SortField, type SortDirection } from '@/domains/listings/queries'
import { ListingsFilters } from '@/components/listings/listings-filters'
import { ListingCard } from '@/components/listings/listing-card'
import { ListingsPagination } from '@/components/listings/listings-pagination'
import { Button } from '@/components/ui/button'

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams
  const type = params['type'] === 'location' ? 'à louer' : params['type'] === 'vente' ? 'à vendre' : ''
  const city = params['city'] ? ` à ${params['city']}` : ' au Sénégal'
  const title = type ? `Annonces ${type}${city}` : `Annonces immobilières${city}`
  return {
    title,
    description: `Trouvez votre bien immobilier${city}. Appartements, maisons, villas, terrains.`,
  }
}

export default async function AnnoncesPage({ searchParams }: PageProps) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params['page'] ?? '1', 10))

  const sortParam = params['sort'] ?? 'created_at_desc'
  const sortMap: Record<string, { field: SortField; direction: SortDirection }> = {
    'created_at_desc': { field: 'created_at', direction: 'desc' },
    'price_asc':       { field: 'price',       direction: 'asc' },
    'price_desc':      { field: 'price',       direction: 'desc' },
    'surface_m2_desc': { field: 'surface_m2',  direction: 'desc' },
  }
  const sort = sortMap[sortParam] ?? { field: 'created_at' as SortField, direction: 'desc' as SortDirection }

  const { listings, total, pages } = await getListings({
    filters: {
      type: params['type'] as 'vente' | 'location' | undefined,
      city: params['city'],
      property_type: params['property_type'],
    },
    sort,
    page,
  })

  const filterParams = {
    type: params['type'],
    city: params['city'],
    property_type: params['property_type'],
    sort: params['sort'],
  }

  return (
    <div style={{ background: '#fafaf8', minHeight: '100vh' }}>
      <div className="container-page py-8">

        {/* En-tête */}
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1
              className="text-3xl font-bold"
              style={{ color: '#0D1B3E', letterSpacing: '-0.025em' }}
            >
              Annonces Immobilières
            </h1>
            {(params['type'] || params['city']) && (
              <p className="mt-1 text-sm capitalize" style={{ color: '#6b7280' }}>
                {params['type'] === 'vente' ? 'À vendre' : params['type'] === 'location' ? 'À louer' : ''}
                {params['city'] ? ` · ${params['city']}` : ''}
              </p>
            )}
          </div>
          <Button asChild size="sm" className="hidden sm:flex gap-2">
            <Link href="/compte/annonces/nouvelle">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Déposer une annonce
            </Link>
          </Button>
        </div>

        {/* Filtres */}
        <ListingsFilters currentParams={filterParams} total={total} />

        {/* Grille */}
        <div className="mt-6">
          {listings.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map(listing => (
                <ListingCard
                  key={listing.id}
                  listing={listing as Parameters<typeof ListingCard>[0]['listing']}
                />
              ))}
            </div>
          ) : (
            <div
              className="rounded-2xl py-20 text-center"
              style={{ border: '2px dashed #e8e8e2', background: '#ffffff' }}
            >
              <p className="text-lg font-semibold" style={{ color: '#0D1B3E' }}>
                Aucune annonce trouvée
              </p>
              <p className="mt-2 text-sm" style={{ color: '#9ca3af' }}>
                Essayez de modifier vos filtres.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Button asChild variant="outline">
                  <Link href="/annonces">Voir toutes les annonces</Link>
                </Button>
                <Button asChild>
                  <Link href="/compte/annonces/nouvelle">Publier une annonce</Link>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="mt-10">
            <ListingsPagination currentPage={page} totalPages={pages} searchParams={params} />
          </div>
        )}
      </div>
    </div>
  )
}
