// src/app/(dashboard)/compte/annonces/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/domains/auth/session'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatPrice } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Mes annonces',
  robots: { index: false, follow: false },
}

// ─── Status helpers ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'success' | 'warning' | 'secondary'> = {
    published: 'success',
    draft: 'warning',
    archived: 'secondary',
  }
  const labels: Record<string, string> = {
    published: 'Publiée',
    draft: 'Brouillon',
    archived: 'Archivée',
  }
  return (
    <Badge variant={variants[status] ?? 'secondary'}>
      {labels[status] ?? status}
    </Badge>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MesAnnoncesPage() {
  const user = await requireAuth()
  const supabase = await createClient()

  const { data: listings } = await supabase
    .from('listings')
    .select('id, title, price, city, type, property_type, status, slug, created_at, images')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mes annonces</h1>
          <p className="mt-1 text-sm text-gray-500">
            {listings?.length ?? 0} annonce{(listings?.length ?? 0) > 1 ? 's' : ''}
          </p>
        </div>
        <Button asChild>
          <Link href="/compte/annonces/nouvelle">+ Nouvelle annonce</Link>
        </Button>
      </div>

      {/* Liste */}
      {!listings || listings.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-lg font-medium text-gray-900">Aucune annonce</p>
          <p className="mt-2 text-sm text-gray-500">
            Publiez votre premier bien immobilier gratuitement.
          </p>
          <Button asChild className="mt-6">
            <Link href="/compte/annonces/nouvelle">Publier une annonce</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map(listing => (
            <div
              key={listing.id}
              className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
            >
              {/* Miniature */}
              <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                {listing.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={listing.images[0]}
                    alt={listing.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <svg className="h-6 w-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Infos */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <StatusBadge status={listing.status} />
                  <span className="text-xs text-gray-400 capitalize">{listing.type}</span>
                </div>
                <p className="font-medium text-gray-900 truncate">{listing.title}</p>
                <p className="text-sm text-gray-500 capitalize">
                  {listing.city}
                  {listing.price ? ` · ${formatPrice(listing.price)}` : ''}
                </p>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 gap-2">
                {listing.status === 'published' && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/annonces/${listing.slug}`} target="_blank">
                      Voir
                    </Link>
                  </Button>
                )}
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/compte/annonces/${listing.id}/modifier`}>
                    Modifier
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
