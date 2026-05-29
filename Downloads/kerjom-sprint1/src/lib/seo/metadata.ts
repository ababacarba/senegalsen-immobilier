import type { Metadata } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kerjom.com'

interface BaseMetadataInput {
  title: string
  description: string
  path: string
  image?: string
  noIndex?: boolean
}

interface ListingMetadataInput {
  title: string
  description: string
  slug: string
  city: string
  price?: number
  type: 'vente' | 'location'
  propertyType: string
  imageUrl?: string
}

export function buildMetadata({ title, description, path, image, noIndex = false }: BaseMetadataInput): Metadata {
  const url = `${BASE_URL}${path}`
  const fullImage = image?.startsWith('http') ? image : image ? `${BASE_URL}${image}` : undefined
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images: fullImage ? [{ url: fullImage, width: 1200, height: 630 }] : [] },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
  }
}

export function buildListingMetadata({ title, description, slug, city, price, type, propertyType, imageUrl }: ListingMetadataInput): Metadata {
  const action = type === 'vente' ? 'à vendre' : 'à louer'
  const seoTitle = `${title} — ${city} | Kërjom`
  const seoDescription = price
    ? `${propertyType} ${action} à ${city}. ${description.slice(0, 100).trim()}...`
    : description.slice(0, 160).trim()
  return buildMetadata({ title: seoTitle, description: seoDescription, path: `/annonces/${slug}`, image: imageUrl })
}

export function buildListingJsonLd(listing: {
  title: string
  description: string
  slug: string
  city: string
  price?: number
  type: 'vente' | 'location'
  imageUrl?: string
  createdAt: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: listing.title,
    description: listing.description,
    url: `${BASE_URL}/annonces/${listing.slug}`,
    image: listing.imageUrl,
    offers: listing.price ? { '@type': 'Offer', price: listing.price, priceCurrency: 'XOF' } : undefined,
    address: { '@type': 'PostalAddress', addressLocality: listing.city, addressCountry: 'SN' },
    datePosted: listing.createdAt,
  }
}
