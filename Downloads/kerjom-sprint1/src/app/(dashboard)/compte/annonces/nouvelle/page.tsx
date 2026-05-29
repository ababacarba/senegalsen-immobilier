// src/app/(dashboard)/compte/annonces/nouvelle/page.tsx
import type { Metadata } from 'next'
import { ListingForm } from '@/components/listings/listing-form'

export const metadata: Metadata = {
  title: 'Publier une annonce',
  robots: { index: false, follow: false },
}

export default function NouvelleAnnoncePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Publier une annonce</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gratuit · Visible immédiatement · Sans engagement
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <ListingForm />
      </div>
    </div>
  )
}
