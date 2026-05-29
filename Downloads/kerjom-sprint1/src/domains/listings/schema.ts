import { z } from 'zod'

// ─── Enums (miroir des enums PostgreSQL) ──────────────────────────────────────

export const LISTING_TYPES = ['vente', 'location'] as const
export const PROPERTY_TYPES = [
  'appartement', 'maison', 'villa', 'terrain',
  'bureau', 'commerce', 'immeuble',
] as const
export const LISTING_STATUSES = ['draft', 'published', 'archived'] as const

export type ListingType = typeof LISTING_TYPES[number]
export type PropertyType = typeof PROPERTY_TYPES[number]
export type ListingStatus = typeof LISTING_STATUSES[number]

// ─── Schema de création (depuis FormData) ─────────────────────────────────────

export const createListingSchema = z.object({
  title: z
    .string()
    .trim()
    .min(10, 'Le titre doit faire au moins 10 caractères')
    .max(200, 'Le titre ne peut pas dépasser 200 caractères'),

  description: z
    .string()
    .trim()
    .min(20, 'La description doit faire au moins 20 caractères')
    .max(5000, 'La description est trop longue'),

  type: z.enum(LISTING_TYPES, {
    required_error: 'Le type de transaction est requis',
    invalid_type_error: 'Type de transaction invalide',
  }),

  property_type: z.enum(PROPERTY_TYPES, {
    required_error: 'Le type de bien est requis',
    invalid_type_error: 'Type de bien invalide',
  }),

  price: z
    .string()
    .optional()
    .transform(v => (v && v.trim() !== '' ? parseFloat(v) : undefined))
    .pipe(
      z.number().positive('Le prix doit être positif').optional()
    ),

  surface_m2: z
    .string()
    .optional()
    .transform(v => (v && v.trim() !== '' ? parseFloat(v) : undefined))
    .pipe(
      z.number().positive('La surface doit être positive').max(50000, 'Surface trop grande').optional()
    ),

  city: z
    .string()
    .trim()
    .min(2, 'La ville est requise')
    .max(100, 'Nom de ville trop long')
    .transform(v => v.toLowerCase()),

  neighborhood: z
    .string()
    .trim()
    .max(100, 'Nom de quartier trop long')
    .optional()
    .transform(v => (v === '' ? undefined : v)),

  phone: z
    .string()
    .trim()
    .max(20, 'Numéro de téléphone trop long')
    .optional()
    .transform(v => (v === '' ? undefined : v)),

  images: z
    .string()
    .optional()
    .transform(v => {
      if (!v) return []
      try {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed) ? parsed.filter(Boolean) : []
      } catch {
        return []
      }
    })
    .pipe(
      z.array(z.string().url('URL image invalide')).max(5, 'Maximum 5 images').default([])
    ),
})

export type CreateListingInput = z.infer<typeof createListingSchema>

// ─── Schema de filtre (depuis searchParams URL) ───────────────────────────────

export const listingFilterSchema = z.object({
  type: z.enum(LISTING_TYPES).optional(),
  property_type: z.enum(PROPERTY_TYPES).optional(),
  city: z.string().trim().toLowerCase().optional(),
  price_min: z
    .string()
    .optional()
    .transform(v => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().positive().optional()),
  price_max: z
    .string()
    .optional()
    .transform(v => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().positive().optional()),
  surface_min: z
    .string()
    .optional()
    .transform(v => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().positive().optional()),
  page: z
    .string()
    .optional()
    .transform(v => (v ? Math.max(1, parseInt(v, 10)) : 1)),
  sort: z
    .string()
    .optional()
    .default('created_at_desc'),
})

export type ListingFilters = z.infer<typeof listingFilterSchema>
