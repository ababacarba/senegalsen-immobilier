'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * Error boundary global — capture toutes les erreurs non gérées.
 * Sentry les capture automatiquement via captureException.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="fr" suppressHydrationWarning>
      <body>
        <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Une erreur est survenue
          </h1>
          <p className="text-gray-500">
            L'équipe a été notifiée automatiquement.
          </p>
          <button
            onClick={reset}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  )
}
