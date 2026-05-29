'use client'

import * as React from 'react'
import { createListingAction, type ListingActionState } from '@/domains/listings/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImageUploader } from './image-uploader'
import { cn } from '@/lib/utils'

// ─── Constantes ───────────────────────────────────────────────────────────────

const PROPERTY_TYPES = [
  { value: 'appartement', label: 'Appartement' },
  { value: 'maison', label: 'Maison' },
  { value: 'villa', label: 'Villa' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'bureau', label: 'Bureau' },
  { value: 'commerce', label: 'Commerce' },
  { value: 'immeuble', label: 'Immeuble' },
]

const CITIES = [
  'Dakar', 'Thiès', 'Saint-Louis', 'Ziguinchor', 'Mbour',
  'Rufisque', 'Kaolack', 'Touba', 'Diourbel', 'Louga',
]

// ─── Composant ────────────────────────────────────────────────────────────────

export function ListingForm() {
  const [state, setState] = React.useState<ListingActionState>({ status: 'idle' })
  const [isPending, setIsPending] = React.useState(false)
  const [type, setType] = React.useState<'vente' | 'location'>('vente')
  const [images, setImages] = React.useState<string[]>([])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsPending(true)

    const formData = new FormData(e.currentTarget)
    formData.set('type', type)
    formData.set('images', JSON.stringify(images))

    const result = await createListingAction({ status: 'idle' }, formData)
    // createListingAction redirige si succès — on arrive ici seulement si erreur
    if (result) setState(result)
    setIsPending(false)
  }

  const selectClass = cn(
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900',
    'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors'
  )
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5'

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {/* Erreur globale */}
      {state.status === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {state.message}
        </div>
      )}

      {/* ─── Type de transaction ──────────────────────────────────────── */}
      <div>
        <label className={labelClass}>Type de transaction *</label>
        <div className="flex gap-3">
          {[
            { value: 'vente', label: '🏠 Vente' },
            { value: 'location', label: '🔑 Location' },
          ].map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value as 'vente' | 'location')}
              className={cn(
                'flex-1 rounded-xl border-2 py-3 text-sm font-medium transition-all',
                type === t.value
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Type de bien ────────────────────────────────────────────── */}
      <div>
        <label className={labelClass} htmlFor="property_type">Type de bien *</label>
        <select id="property_type" name="property_type" className={selectClass} required>
          <option value="">Sélectionner un type...</option>
          {PROPERTY_TYPES.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* ─── Titre ───────────────────────────────────────────────────── */}
      <Input
        name="title"
        label="Titre de l'annonce *"
        placeholder="Ex: Bel appartement F3 lumineux au Plateau Dakar"
        required
        minLength={10}
        maxLength={200}
        hint="Minimum 10 caractères — décrivez brièvement votre bien"
      />

      {/* ─── Description ─────────────────────────────────────────────── */}
      <div>
        <label className={labelClass} htmlFor="description">Description *</label>
        <textarea
          id="description"
          name="description"
          rows={5}
          required
          minLength={20}
          placeholder="Décrivez votre bien en détail : caractéristiques, équipements, environnement, points forts..."
          className={cn(selectClass, 'resize-none leading-relaxed')}
        />
        <p className="mt-1.5 text-xs text-gray-400">Minimum 20 caractères</p>
      </div>

      {/* ─── Prix et Surface ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          name="price"
          type="number"
          label={`Prix en FCFA${type === 'location' ? ' / mois' : ''}`}
          placeholder={type === 'location' ? 'Ex: 450000' : 'Ex: 75000000'}
          min={0}
          hint="Laisser vide si prix sur demande"
        />
        <Input
          name="surface_m2"
          type="number"
          label="Surface (m²)"
          placeholder="Ex: 85"
          min={0}
          hint="Surface habitable en m²"
        />
      </div>

      {/* ─── Localisation ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="city">Ville *</label>
          <select id="city" name="city" className={selectClass} required>
            <option value="">Sélectionner une ville...</option>
            {CITIES.map(c => (
              <option key={c} value={c.toLowerCase()}>{c}</option>
            ))}
          </select>
        </div>
        <Input
          name="neighborhood"
          label="Quartier"
          placeholder="Ex: Plateau, Almadies, Mermoz..."
        />
      </div>

      {/* ─── Téléphone WhatsApp ───────────────────────────────────────── */}
      <Input
        name="phone"
        type="tel"
        label="Numéro WhatsApp"
        placeholder="+221 77 000 00 00"
        hint="Les acheteurs vous contacteront directement via WhatsApp"
      />

      {/* ─── Photos ──────────────────────────────────────────────────── */}
      <div>
        <label className={labelClass}>Photos de votre bien</label>
        <ImageUploader onUpload={setImages} maxImages={5} />
        <p className="mt-1.5 text-xs text-gray-400">
          Les annonces avec photos reçoivent 3× plus de contacts
        </p>
      </div>

      {/* ─── Submit ───────────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 pt-6">
        <Button
          type="submit"
          size="lg"
          className="w-full sm:w-auto"
          loading={isPending}
        >
          Publier l'annonce gratuitement
        </Button>
        <p className="mt-3 text-xs text-gray-400">
          Votre annonce sera publiée immédiatement et visible par tous.
        </p>
      </div>
    </form>
  )
}
