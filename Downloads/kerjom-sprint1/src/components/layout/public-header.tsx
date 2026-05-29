import Link from 'next/link'
import { publicNavLinks } from '@/components/navigation/nav-links'
import { MobileMenu } from './mobile-menu'
import { getUser } from '@/domains/auth/session'

export async function PublicHeader() {
  const user = await getUser()

  return (
    <header className="sticky top-0 z-50 bg-white border-b" style={{ borderColor: '#e8e8e2' }}>
      <div className="container-page flex h-16 items-center gap-6">

        {/* ── Logo Variante 1 ── */}
        <Link href="/" className="flex items-center gap-3 shrink-0" aria-label="Kërjom — Accueil">
          {/* Icône maison navy avec porte bleue */}
          <div style={{ width: 38, height: 38, background: '#0D1B3E', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 38 38" width="38" height="38" fill="none" aria-hidden="true">
              <polygon points="19,7 31,16 31,31 25,31 25,22 13,22 13,31 7,31 7,16" fill="white" opacity="0.93"/>
              <rect x="13" y="22" width="12" height="9" fill="#3B82F6" opacity="0.9"/>
            </svg>
          </div>

          {/* Wordmark */}
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.15em', color: '#0D1B3E', textTransform: 'uppercase' }}>
              KËRJOM
            </span>
            <span style={{ fontSize: 7.5, fontWeight: 500, letterSpacing: '0.22em', color: '#F59E0B', textTransform: 'uppercase', marginTop: 2 }}>
              IMMOBILIER
            </span>
          </div>
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center flex-1" aria-label="Navigation principale">
          {publicNavLinks.map(link => (
            <Link
              key={link.label}
              href={link.href}
              className="px-4 py-2 text-sm font-medium rounded-md transition-colors hover:bg-gray-50"
              style={{ color: '#374151' }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-4">
          {user ? (
            <Link href="/compte" className="hidden md:block text-sm font-medium transition-colors hover:text-gray-900" style={{ color: '#374151' }}>
              Mon espace
            </Link>
          ) : (
            <Link href="/connexion" className="hidden md:block text-sm font-medium transition-colors hover:text-gray-900" style={{ color: '#374151' }}>
              Se connecter
            </Link>
          )}
          <Link
            href="/compte/annonces/nouvelle"
            className="hidden md:flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg border-2 transition-all hover:opacity-90"
            style={{ color: '#0D1B3E', borderColor: '#0D1B3E', letterSpacing: '0.01em' }}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Déposer une annonce
          </Link>
          <MobileMenu isAuthenticated={!!user} />
        </div>
      </div>
    </header>
  )
}
