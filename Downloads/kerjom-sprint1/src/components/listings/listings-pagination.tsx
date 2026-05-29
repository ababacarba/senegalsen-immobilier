import Link from 'next/link'
import { cn } from '@/lib/utils'

interface ListingsPaginationProps {
  currentPage: number
  totalPages: number
  searchParams: Record<string, string | undefined>
}

export function ListingsPagination({
  currentPage,
  totalPages,
  searchParams,
}: ListingsPaginationProps) {
  if (totalPages <= 1) return null

  function buildUrl(page: number) {
    const params = new URLSearchParams()
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value && key !== 'page') params.set(key, value)
    })
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return qs ? `/annonces?${qs}` : '/annonces'
  }

  // Générer les pages à afficher (max 5 autour de la page courante)
  const pages: (number | '...')[] = []
  const delta = 2

  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - delta && i <= currentPage + delta)
    ) {
      pages.push(i)
    } else if (
      i === currentPage - delta - 1 ||
      i === currentPage + delta + 1
    ) {
      pages.push('...')
    }
  }

  const btnBase = cn(
    'flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1'
  )

  return (
    <nav
      className="flex items-center justify-center gap-1"
      aria-label="Pagination des annonces"
    >
      {/* Précédent */}
      {currentPage > 1 ? (
        <Link
          href={buildUrl(currentPage - 1)}
          className={cn(btnBase, 'border border-gray-200 text-gray-700 hover:bg-gray-50')}
          aria-label="Page précédente"
        >
          ←
        </Link>
      ) : (
        <span className={cn(btnBase, 'cursor-not-allowed text-gray-300')} aria-hidden>←</span>
      )}

      {/* Pages */}
      {pages.map((page, idx) =>
        page === '...' ? (
          <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">
            …
          </span>
        ) : (
          <Link
            key={page}
            href={buildUrl(page)}
            className={cn(
              btnBase,
              page === currentPage
                ? 'bg-brand-600 text-white'
                : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
            )}
            aria-label={`Page ${page}`}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </Link>
        )
      )}

      {/* Suivant */}
      {currentPage < totalPages ? (
        <Link
          href={buildUrl(currentPage + 1)}
          className={cn(btnBase, 'border border-gray-200 text-gray-700 hover:bg-gray-50')}
          aria-label="Page suivante"
        >
          →
        </Link>
      ) : (
        <span className={cn(btnBase, 'cursor-not-allowed text-gray-300')} aria-hidden>→</span>
      )}
    </nav>
  )
}
