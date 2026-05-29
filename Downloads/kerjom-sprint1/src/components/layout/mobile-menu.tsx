'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { publicNavLinks } from '@/components/navigation/nav-links'
import { Button } from '@/components/ui/button'

interface MobileMenuProps {
  isAuthenticated: boolean
}

export function MobileMenu({ isAuthenticated }: MobileMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const pathname = usePathname()

  // Fermer le menu sur changement de route
  React.useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  // Bloquer le scroll quand le menu est ouvert
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  return (
    <>
      {/* Bouton hamburger */}
      <button
        type="button"
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg',
          'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          'md:hidden'
        )}
        onClick={() => setIsOpen(v => !v)}
        aria-expanded={isOpen}
        aria-controls="mobile-nav"
        aria-label={isOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          )}
        </svg>
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Drawer */}
      <nav
        id="mobile-nav"
        aria-label="Navigation mobile"
        className={cn(
          'fixed inset-x-0 top-16 z-50 md:hidden',
          'border-b border-border bg-background shadow-lg',
          'transition-all duration-200',
          isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'
        )}
      >
        <div className="container-page space-y-1 py-4">
          {publicNavLinks.map(link => (
            <Link
              key={link.label}
              href={link.href}
              className={cn(
                'block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                pathname === link.href
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {link.label}
            </Link>
          ))}

          {/* CTA auth */}
          <div className="border-t border-border pt-4 mt-4 flex flex-col gap-2">
            {isAuthenticated ? (
              <Button asChild variant="primary" className="w-full">
                <Link href="/compte">Mon compte</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/connexion">Connexion</Link>
                </Button>
                <Button asChild variant="primary" className="w-full">
                  <Link href="/inscription">S'inscrire gratuitement</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>
    </>
  )
}
