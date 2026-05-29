import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getListing, getSimilarListings } from '@/domains/listings/queries'
import { buildListingMetadata, buildListingJsonLd } from '@/lib/seo/metadata'
import { ImageGallery } from '@/components/listings/image-gallery'
import { ListingCard } from '@/components/listings/listing-card'
import { formatPrice } from '@/lib/utils'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const listing = await getListing(slug)
  if (!listing) return { title: 'Annonce introuvable' }
  return buildListingMetadata({
    title: listing.title,
    description: listing.description,
    slug: listing.slug,
    city: listing.city,
    price: listing.price ?? undefined,
    type: listing.type,
    propertyType: listing.property_type,
    imageUrl: listing.images?.[0] ?? undefined,
  })
}

export default async function ListingPage({ params }: PageProps) {
  const { slug } = await params
  const listing = await getListing(slug)
  if (!listing) notFound()

  const similar = await getSimilarListings({
    id: listing.id,
    city: listing.city,
    type: listing.type,
    property_type: listing.property_type,
  })

  const jsonLd = buildListingJsonLd({
    title: listing.title,
    description: listing.description,
    slug: listing.slug,
    city: listing.city,
    price: listing.price ?? undefined,
    type: listing.type,
    imageUrl: listing.images?.[0] ?? undefined,
    createdAt: listing.created_at,
  })

  const sellerPhone = (listing as Record<string, unknown>)['phone'] as string | null
  const whatsappMessage = encodeURIComponent(
    `Bonjour, je suis intéressé(e) par votre annonce "${listing.title}" sur Kërjom. Pouvez-vous me donner plus d'informations ?`
  )
  const whatsappUrl = sellerPhone
    ? `https://wa.me/${sellerPhone.replace(/\D/g, '')}?text=${whatsappMessage}`
    : `https://wa.me/?text=${whatsappMessage}`

  const priceLabel = listing.price
    ? `${formatPrice(listing.price)}${listing.type === 'location' ? '/mois' : ''}`
    : 'Prix sur demande'

  const details = [
    { label: 'Type', value: listing.property_type },
    { label: 'Transaction', value: listing.type === 'vente' ? 'Vente' : 'Location' },
    listing.surface_m2 && { label: 'Surface', value: `${listing.surface_m2} m²` },
    listing.price_per_m2 && listing.type === 'vente' && { label: 'Prix/m²', value: formatPrice(listing.price_per_m2) },
    { label: 'Ville', value: listing.city },
    (listing as Record<string, unknown>)['neighborhood'] && { label: 'Quartier', value: (listing as Record<string, unknown>)['neighborhood'] as string },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ background: '#fafaf8', minHeight: '100vh' }}>

        {/* Breadcrumb */}
        <div style={{ background: '#ffffff', borderBottom: '1px solid #e8e8e2' }}>
          <div className="container-page py-3">
            <nav className="flex items-center gap-2 text-sm" style={{ color: '#9ca3af' }} aria-label="Fil d'Ariane">
              <Link href="/" className="transition-colors hover:text-gray-900">Accueil</Link>
              <span aria-hidden>›</span>
              <Link href="/annonces" className="transition-colors hover:text-gray-900">Annonces</Link>
              <span aria-hidden>›</span>
              <span className="truncate" style={{ color: '#0D1B3E', fontWeight: 500 }}>{listing.title}</span>
            </nav>
          </div>
        </div>

        <div className="container-page py-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">

            {/* ─── Colonne principale ─────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-6">

              {/* Galerie */}
              <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid #e8e8e2' }}>
                <ImageGallery images={listing.images ?? []} title={listing.title} />
              </div>

              {/* Infos principales */}
              <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #e8e8e2' }}>
                {/* Type + transaction */}
                <div className="mb-4 flex flex-wrap gap-2">
                  <span
                    className="inline-block px-3 py-1 text-xs font-semibold tracking-wide rounded-full"
                    style={{ background: '#0D1B3E', color: '#ffffff' }}
                  >
                    {listing.type === 'vente' ? 'VENTE' : 'LOCATION'}
                  </span>
                  <span
                    className="inline-block px-3 py-1 text-xs font-semibold tracking-wide rounded-full capitalize"
                    style={{ background: '#f4f4f0', color: '#374151' }}
                  >
                    {listing.property_type}
                  </span>
                </div>

                <h1
                  className="text-2xl font-bold sm:text-3xl"
                  style={{ color: '#0D1B3E', letterSpacing: '-0.025em' }}
                >
                  {listing.title}
                </h1>

                <p className="mt-2 flex items-center gap-1.5 text-sm" style={{ color: '#6b7280' }}>
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <span className="capitalize">
                    {(listing as Record<string, unknown>)['neighborhood'] ? `${(listing as Record<string, unknown>)['neighborhood']}, ` : ''}{listing.city}
                  </span>
                </p>

                {/* Prix */}
                <div className="mt-6 text-4xl font-bold" style={{ color: '#0D1B3E', letterSpacing: '-0.03em' }}>
                  {priceLabel}
                </div>

                {/* Caractéristiques */}
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {details.map(d => (
                    <div
                      key={d.label}
                      className="rounded-xl p-3.5"
                      style={{ background: '#fafaf8', border: '1px solid #e8e8e2' }}
                    >
                      <div className="text-xs font-medium uppercase tracking-wider" style={{ color: '#9ca3af' }}>
                        {d.label}
                      </div>
                      <div className="mt-1 text-sm font-semibold capitalize" style={{ color: '#0D1B3E' }}>
                        {d.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #e8e8e2' }}>
                <h2 className="mb-4 text-lg font-bold" style={{ color: '#0D1B3E' }}>Description</h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: '#4b5563' }}>
                  {listing.description || 'Aucune description fournie.'}
                </p>
              </div>
            </div>

            {/* ─── Sidebar contact sticky ──────────────────────────────── */}
            <div>
              <div className="sticky top-24 space-y-4">

                {/* Card contact principale */}
                <div
                  className="rounded-2xl bg-white p-6"
                  style={{ border: '1px solid #e8e8e2', boxShadow: '0 4px 24px rgba(10,15,29,0.06)' }}
                >
                  <h2 className="mb-1 text-lg font-bold" style={{ color: '#0D1B3E' }}>
                    Contacter le propriétaire
                  </h2>
                  <p className="mb-5 text-sm" style={{ color: '#9ca3af' }}>
                    Réponse rapide garantie
                  </p>

                  {/* WhatsApp CTA */}
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-3 rounded-xl py-4 text-sm font-bold text-white transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    style={{ background: '#25D366', letterSpacing: '0.01em' }}
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    Contacter via WhatsApp
                  </a>

                  {/* Résumé bien */}
                  <div className="mt-5 space-y-2.5 pt-5" style={{ borderTop: '1px solid #e8e8e2' }}>
                    {details.slice(0, 4).map(d => (
                      <div key={d.label} className="flex items-center justify-between text-sm">
                        <span style={{ color: '#9ca3af' }}>{d.label}</span>
                        <span className="font-semibold capitalize" style={{ color: '#0D1B3E' }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Badge sécurité */}
                <div
                  className="flex items-center gap-3 rounded-xl p-4"
                  style={{ background: '#f0faf5', border: '1px solid #b5e5ce' }}
                >
                  <svg className="h-5 w-5 shrink-0" style={{ color: '#1a7d52' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                  <p className="text-xs leading-relaxed" style={{ color: '#166542' }}>
                    Annonce vérifiée par l'équipe Kërjom. Vos échanges sont sécurisés.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Annonces similaires */}
          {similar.length > 0 && (
            <div className="mt-16">
              <h2 className="mb-6 text-xl font-bold" style={{ color: '#0D1B3E', letterSpacing: '-0.02em' }}>
                Annonces similaires
              </h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {similar.map(s => (
                  <ListingCard
                    key={s.id}
                    listing={s as Parameters<typeof ListingCard>[0]['listing']}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
