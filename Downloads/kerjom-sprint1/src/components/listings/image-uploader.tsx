'use client'

import * as React from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface ImageUploaderProps {
  onUpload: (urls: string[]) => void
  maxImages?: number
}

export function ImageUploader({ onUpload, maxImages = 5 }: ImageUploaderProps) {
  const [uploading, setUploading] = React.useState(false)
  const [previews, setPreviews] = React.useState<string[]>([])
  const [uploadedUrls, setUploadedUrls] = React.useState<string[]>([])
  const [error, setError] = React.useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return

    const remaining = maxImages - uploadedUrls.length
    if (remaining <= 0) return

    setUploading(true)
    setError(null)

    const supabase = createClient()
    const newUrls: string[] = []
    const newPreviews: string[] = []

    for (const file of files.slice(0, remaining)) {
      // Preview local immédiat
      newPreviews.push(URL.createObjectURL(file))

      // Upload vers Supabase Storage
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `listings/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('listing-images')
        .upload(path, file, { cacheControl: '3600', upsert: false })

      if (uploadError) {
        console.error('[ImageUploader]', uploadError.message)
        setError('Erreur lors du chargement d\'une image.')
        continue
      }

      const { data } = supabase.storage.from('listing-images').getPublicUrl(path)
      newUrls.push(data.publicUrl)
    }

    const updatedUrls = [...uploadedUrls, ...newUrls]
    const updatedPreviews = [...previews, ...newPreviews]

    setUploadedUrls(updatedUrls)
    setPreviews(updatedPreviews)
    onUpload(updatedUrls)
    setUploading(false)

    // Reset input pour permettre de re-sélectionner les mêmes fichiers
    e.target.value = ''
  }

  function removeImage(index: number) {
    const updatedUrls = uploadedUrls.filter((_, i) => i !== index)
    const updatedPreviews = previews.filter((_, i) => i !== index)
    setUploadedUrls(updatedUrls)
    setPreviews(updatedPreviews)
    onUpload(updatedUrls)
  }

  return (
    <div className="space-y-3">
      {/* Zone de drop */}
      <label
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl',
          'border-2 border-dashed border-gray-300 bg-gray-50 p-8',
          'transition-colors hover:border-brand-400 hover:bg-brand-50',
          (uploading || uploadedUrls.length >= maxImages) && 'cursor-not-allowed opacity-50'
        )}
      >
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={handleFileChange}
          disabled={uploading || uploadedUrls.length >= maxImages}
        />
        <svg
          className="mb-3 h-10 w-10 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-sm font-medium text-gray-700">
          {uploading ? 'Chargement en cours...' : 'Cliquez pour ajouter des photos'}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {uploadedUrls.length}/{maxImages} photos · JPG, PNG, WebP · max 5 MB
        </p>
      </label>

      {/* Erreur */}
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {/* Previews */}
      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {previews.map((src, idx) => (
            <div key={idx} className="group relative aspect-square overflow-hidden rounded-lg bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Photo ${idx + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`Supprimer la photo ${idx + 1}`}
              >
                ×
              </button>
              {idx === 0 && (
                <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white">
                  Principale
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
