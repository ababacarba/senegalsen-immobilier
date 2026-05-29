'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { cn } from '@/lib/utils'
import { getNavLinksForRole } from '@/components/navigation/nav-links'
import { Badge } from '@/components/ui/badge'
import { signOutAction } from '@/domains/auth/actions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardSidebarProps {
  user: User
  role: 'user' | 'admin'
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function DashboardSidebar({ user, role }: DashboardSidebarProps) {
  const pathname = usePathname()
  const [isMobileOpen, setIsMobileOpen] = React.useState(false)

  const navLinks = getNavLinksForRole(role)
  const fullName = user.user_metadata?.['full_name'] as string | undefined
  const initials = (fullName ?? user.email ?? 'KJ').slice(0, 2).toUpperCase()

  React.useEffect(() => {
    setIsMobileOpen(false)
  }, [pathname])

  const isActive = (href: string) =>
    href === '/compte' ? pathname === '/compte' : pathname.startsWith(href)

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
        <Link href="/" className="font-bold text-lg text-primary hover:opacity-90 transition-opacity">
          Kërjom
        </Link>
        {role === 'admin' && <Badge variant="warning">Admin</Badge>}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Navigation dashboard">
        {navLinks.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive(link.href)
                ? 'bg-primary text-primary-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
            aria-current={isActive(link.href) ? 'page' : undefined}
          >
            <span>{link.label}</span>
            {link.badge && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {link.badge}
              </Badge>
            )}
          </Link>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-4 space-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-sm font-semibold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {fullName ?? 'Mon compte'}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        {/* Signout via Server Action — pas de useRouter, pas de client Supabase */}
        <form action={signOutAction}>
          <button
            type="submit"
            className={cn(
              'w-full rounded-lg px-3 py-2 text-left text-sm font-medium',
              'text-muted-foreground transition-colors',
              'hover:bg-sidebar-accent hover:text-destructive'
            )}
          >
            ↩ Se déconnecter
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <aside
        className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col"
        aria-label="Navigation principale"
      >
        <SidebarContent />
      </aside>

      {/* Mobile toggle */}
      <div className="fixed bottom-4 left-4 z-50 lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileOpen(v => !v)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-brand-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-expanded={isMobileOpen}
          aria-label={isMobileOpen ? 'Fermer la navigation' : 'Ouvrir la navigation'}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            {isMobileOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            }
          </svg>
        </button>
      </div>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 border-r border-sidebar-border bg-sidebar lg:hidden',
          'transition-transform duration-300 ease-in-out',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Navigation mobile"
      >
        <SidebarContent />
      </aside>
    </>
  )
}
