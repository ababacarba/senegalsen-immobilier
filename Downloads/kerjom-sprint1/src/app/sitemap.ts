import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kerjom.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // ─── Pages statiques ──────────────────────────────────────────────────────
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${BASE_URL}/annonces`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/a-propos`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/comment-ca-marche`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ]

  // ─── Pages dynamiques — listings publiés ──────────────────────────────────
  try {
    const supabase = await createClient()
    const { data: listings } = await supabase
      .from('listings')
      .select('slug, updated_at')
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(1000) // max listings dans le sitemap

    const listingPages: MetadataRoute.Sitemap = (listings ?? []).map(listing => ({
      url: `${BASE_URL}/annonces/${listing.slug}`,
      lastModified: new Date(listing.updated_at as string),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))

    return [...staticPages, ...listingPages]
  } catch {
    // Table listings pas encore créée — retourner uniquement les pages statiques
    return staticPages
  }
}
