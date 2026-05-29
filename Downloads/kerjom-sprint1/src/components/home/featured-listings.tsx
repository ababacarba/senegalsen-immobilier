import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { ListingCard } from './listing-card'

/**
 * Section Featured Listings — Server Component.
 * Fetch depuis Supabase. Gère le cas table inexistante (Sprint 5).
 * Sprint 5 : la table listings sera créée avec des annonces réelles.
 */
export async function FeaturedListings() {
  let listings: Array<{
    id: string
    title: string
    price: number | null
    surface_m2: number | null
    city: string
    type: 'vente' | 'location'
    property_type: string
    images: string[]
    slug: string
  }> = []

  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('listings')
      .select('id, title, price, surface_m2, city, type, property_type, images, slug')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(6)

    listings = data ?? []
  } catch {
    // Table listings pas encore créée — Sprint 5
    listings = []
  }

  return (
    <section className="bg-gray-50 py-16 lg:py-20" aria-labelledby="featured-title">
      <div className="container-page">
        {/* Header */}
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="featured-title" className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Dernières annonces
            </h2>
            <p className="mt-1 text-gray-500">
              Les biens immobiliers les plus récents au Sénégal
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/annonces">Voir toutes les annonces</Link>
          </Button>
        </div>

        {/* Grid annonces ou empty state */}
        {listings.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map(listing => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </section>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white py-20 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
        <svg
          className="h-8 w-8 text-brand-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900">Aucune annonce pour le moment</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
        Soyez parmi les premiers à publier votre bien immobilier sur Kërjom.
      </p>
      <div className="mt-6">
        <Button asChild>
          <Link href="/inscription">Publier une annonce gratuitement</Link>
        </Button>
      </div>
    </div>
  )
}
