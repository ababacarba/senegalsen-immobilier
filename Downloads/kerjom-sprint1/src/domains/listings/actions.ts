'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/domains/auth/session'
import { redirect } from 'next/navigation'
import { createListingSchema } from './schema'
import { slugify } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ListingActionState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  errors?: Record<string, string>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSlug(title: string): string {
  const base = slugify(title)
  const suffix = Date.now().toString(36).slice(-5)
  return `${base}-${suffix}`
}

// ─── Créer une annonce ────────────────────────────────────────────────────────

export async function createListingAction(
  _prevState: ListingActionState,
  formData: FormData
): Promise<ListingActionState> {
  // Auth
  let user
  try {
    user = await requireAuth()
  } catch {
    return { status: 'error', message: 'Vous devez être connecté pour publier une annonce.' }
  }

  // Validation stricte avec Zod
  const parsed = createListingSchema.safeParse(Object.fromEntries(formData))

  if (!parsed.success) {
    const errors: Record<string, string> = {}
    parsed.error.errors.forEach(err => {
      const field = err.path[0]?.toString() ?? 'global'
      errors[field] = err.message
    })
    return {
      status: 'error',
      message: parsed.error.errors[0]?.message ?? 'Données invalides',
      errors,
    }
  }

  const data = parsed.data
  const slug = generateSlug(data.title)
  const supabase = await createClient()

  // Insertion avec données normalisées
  const { data: listing, error } = await supabase
    .from('listings')
    .insert({
      title: data.title,
      description: data.description,
      type: data.type,
      property_type: data.property_type,
      price: data.price ?? null,
      surface_m2: data.surface_m2 ?? null,
      city: data.city, // déjà lowercased par le schema
      neighborhood: data.neighborhood ?? null,
      phone: data.phone ?? null,
      images: data.images,
      slug,
      user_id: user.id,
      status: 'published',
    })
    .select('id, slug')
    .single()

  if (error) {
    console.error('[createListingAction]', error.message)
    return { status: 'error', message: "Impossible de créer l'annonce. Réessayez." }
  }

  // Initialiser les métriques
  try {
    await supabase
      .from('listings_metrics')
      .insert({ listing_id: listing.id })
  } catch { /* silencieux */ } // Silencieux si déjà existant

  redirect(`/annonces/${listing.slug}`)
}

// ─── Supprimer une annonce ────────────────────────────────────────────────────

export async function deleteListingAction(
  _prevState: ListingActionState,
  formData: FormData
): Promise<ListingActionState> {
  const user = await requireAuth()
  const id = formData.get('id') as string
  if (!id) return { status: 'error', message: 'ID manquant' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('listings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { status: 'error', message: 'Impossible de supprimer.' }
  return { status: 'success', message: 'Annonce supprimée.' }
}

// ─── Changer le statut ────────────────────────────────────────────────────────

export async function updateListingStatusAction(
  _prevState: ListingActionState,
  formData: FormData
): Promise<ListingActionState> {
  const user = await requireAuth()
  const id = formData.get('id') as string
  const status = formData.get('status') as 'published' | 'archived' | 'draft'

  if (!id || !status) return { status: 'error', message: 'Données manquantes' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('listings')
    .update({ status })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { status: 'error', message: 'Impossible de modifier le statut.' }
  return { status: 'success', message: `Annonce ${status === 'published' ? 'publiée' : 'archivée'}.` }
}
