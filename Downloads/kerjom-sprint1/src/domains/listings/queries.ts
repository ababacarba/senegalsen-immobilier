import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ListingFilters {
  type?: 'vente' | 'location'
  city?: string
  property_type?: string
  price_min?: number
  price_max?: number
  surface_min?: number
}

export type SortField = 'created_at' | 'price' | 'surface_m2' | 'price_per_m2'
export type SortDirection = 'asc' | 'desc'

export interface GetListingsParams {
  filters?: ListingFilters
  sort?: { field: SortField; direction: SortDirection }
  page?: number
  perPage?: number
}

export const PER_PAGE = 12

// ─── Liste des annonces (avec price_per_m2) ───────────────────────────────────

export async function getListings({
  filters = {},
  sort = { field: 'created_at', direction: 'desc' },
  page = 1,
  perPage = PER_PAGE,
}: GetListingsParams = {}) {
  const supabase = await createClient()

  let query = supabase
    .from('listings')
    .select(
      'id, title, price, surface_m2, price_per_m2, city, neighborhood, type, property_type, images, slug, created_at',
      { count: 'exact' }
    )
    .eq('status', 'published')

  // ─── Filtres ───────────────────────────────────────────────────────────────
  if (filters.type) query = query.eq('type', filters.type)
  if (filters.property_type) query = query.eq('property_type', filters.property_type)
  if (filters.city) query = query.ilike('city', `%${filters.city}%`)
  if (filters.price_min) query = query.gte('price', filters.price_min)
  if (filters.price_max) query = query.lte('price', filters.price_max)
  if (filters.surface_min) query = query.gte('surface_m2', filters.surface_min)

  // ─── Tri ───────────────────────────────────────────────────────────────────
  query = query.order(sort.field, {
    ascending: sort.direction === 'asc',
    nullsFirst: false,
  })

  // ─── Pagination ────────────────────────────────────────────────────────────
  const from = (page - 1) * perPage
  query = query.range(from, from + perPage - 1)

  const { data, count, error } = await query

  if (error) {
    console.error('[getListings]', error.message)
    return { listings: [], total: 0, pages: 0 }
  }

  return {
    listings: data ?? [],
    total: count ?? 0,
    pages: Math.ceil((count ?? 0) / perPage),
  }
}

// ─── Fiche annonce (avec métriques) ──────────────────────────────────────────

export async function getListing(slug: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  if (error) {
    console.error('[getListing]', error.message, slug)
    return null
  }

  return data
}

// ─── Incrémenter les vues (appelé côté client) ───────────────────────────────

export async function incrementViews(listingId: string) {
  const supabase = await createClient()

  try {
    await supabase.rpc('increment_listing_views', { p_listing_id: listingId })
  } catch { /* silencieux */ }
}

// ─── Annonces similaires ──────────────────────────────────────────────────────

export async function getSimilarListings(listing: {
  id: string
  city: string
  type: string
  property_type: string
}) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('listings')
    .select('id, title, price, surface_m2, price_per_m2, city, type, property_type, images, slug')
    .eq('status', 'published')
    .eq('type', listing.type)
    .eq('city', listing.city)
    .neq('id', listing.id)
    .limit(3)

  return data ?? []
}

// ─── Annonces de l'utilisateur courant ───────────────────────────────────────

export async function getUserListings(userId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('listings')
    .select('id, title, price, price_per_m2, surface_m2, city, type, property_type, status, slug, created_at, images')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return data ?? []
}
