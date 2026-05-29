'use client'

import * as React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

interface ImageGalleryProps {
  images: string[]
  title: string
}

export function ImageGallery({ images, title }: ImageGalleryProps) {
  const [activeIndex, setActiveIndex] = React.useState(0)

  if (images.length === 0) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-2xl bg-gray-100">
        <svg className="h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Image principale */}
      <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-gray-100">
        <Image
          src={images[activeIndex]!}
          alt={`${title} — photo ${activeIndex + 1}`}
          fill
          sizes="(max-width: 1024px) 100vw, 66vw"
          className="object-cover"
          priority={activeIndex === 0}
        />
        {/* Compteur */}
        {images.length > 1 && (
          <div className="absolute bottom-3 right-3 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
            {activeIndex + 1} / {images.length}
          </div>
        )}
        {/* Navigation prev/next */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setActiveIndex(i => Math.max(0, i - 1))}
              disabled={activeIndex === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-900 shadow-sm transition-opacity hover:bg-white disabled:opacity-30"
              aria-label="Photo précédente"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex(i => Math.min(images.length - 1, i + 1))}
              disabled={activeIndex === images.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-900 shadow-sm transition-opacity hover:bg-white disabled:opacity-30"
              aria-label="Photo suivante"
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={cn(
                'relative h-16 w-24 shrink-0 overflow-hidden rounded-lg transition-all',
                idx === activeIndex
                  ? 'ring-2 ring-brand-600 ring-offset-1'
                  : 'opacity-60 hover:opacity-80'
              )}
              aria-label={`Voir la photo ${idx + 1}`}
            >
              <Image src={src} alt="" fill sizes="96px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
