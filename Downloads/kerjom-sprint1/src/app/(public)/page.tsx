// src/app/(public)/page.tsx
import type { Metadata } from 'next'
import { HeroSection } from '@/components/home/hero-section'
import { FeaturedListings } from '@/components/home/featured-listings'
import { HowItWorks } from '@/components/home/how-it-works'
import { CtaSection } from '@/components/home/cta-section'

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: 'Kërjom — Immobilier au Sénégal',
  description:
    'Trouvez votre bien immobilier au Sénégal. Appartements, maisons, terrains à vendre et à louer à Dakar et partout au Sénégal.',
  openGraph: {
    title: 'Kërjom — Immobilier au Sénégal',
    description:
      'Trouvez votre bien immobilier au Sénégal. Des milliers d\'annonces à Dakar et partout au Sénégal.',
    images: [{ url: '/og-home.jpg', width: 1200, height: 630, alt: 'Kërjom Immobilier Sénégal' }],
    type: 'website',
    locale: 'fr_SN',
  },
  alternates: {
    canonical: 'https://kerjom.com',
  },
}

// ─── JSON-LD ──────────────────────────────────────────────────────────────────

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://kerjom.com/#organization',
      name: 'Kërjom',
      url: 'https://kerjom.com',
      description: 'Marketplace immobilière de référence au Sénégal',
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'SN',
        addressLocality: 'Dakar',
      },
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'contact@kerjom.com',
      },
    },
    {
      '@type': 'WebSite',
      '@id': 'https://kerjom.com/#website',
      url: 'https://kerjom.com',
      name: 'Kërjom',
      publisher: { '@id': 'https://kerjom.com/#organization' },
      inLanguage: 'fr-SN',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: 'https://kerjom.com/annonces?query={search_term_string}',
        },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'RealEstateAgent',
      '@id': 'https://kerjom.com/#business',
      name: 'Kërjom',
      url: 'https://kerjom.com',
      description: 'Marketplace immobilière au Sénégal — vente et location',
      areaServed: {
        '@type': 'Country',
        name: 'Sénégal',
      },
    },
  ],
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <>
      {/* JSON-LD structuré — lu par Google pour les Rich Results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <HeroSection />
      <FeaturedListings />
      <HowItWorks />
      <CtaSection />
    </>
  )
}
