import Link from 'next/link'
import { SearchBox } from './search-box'

const SERVICES = [
  {
    href: '/estimer',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
      </svg>
    ),
    label: 'Estimer votre bien',
  },
  {
    href: '/compte/annonces/nouvelle',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
    label: 'Déposer une annonce',
  },
  {
    href: '/carte-des-prix',
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    ),
    label: 'Carte des prix de l\'immo',
  },
]

export function HeroSection() {
  return (
    <section
      className="relative overflow-hidden"
      style={{ background: '#fafaf8', minHeight: '520px' }}
      aria-labelledby="hero-title"
    >
      <div className="container-page relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 items-center gap-8 py-16 lg:py-20">

          {/* ─── Colonne gauche : texte + search ────────────────────── */}
          <div className="flex flex-col">
            {/* Headline */}
            <h1
              id="hero-title"
              className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold leading-tight mb-8"
              style={{ color: '#0D1B3E', letterSpacing: '-0.03em', lineHeight: 1.08 }}
            >
              L'endroit.{' '}
              <span
                style={{
                  fontFamily: 'var(--font-cormorant)',
                  fontStyle: 'italic',
                  background: 'linear-gradient(135deg, #F59E0B, #F59E0B)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Tout simplement.
              </span>
            </h1>

            {/* Search Box */}
            <SearchBox />

            {/* Services dédiés */}
            <div className="mt-5 flex flex-col gap-3">
              <span
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: '#9ca3af' }}
              >
                Nos services dédiés
              </span>
              <div className="flex flex-wrap gap-2">
                {SERVICES.map(s => (
                  <Link
                    key={s.label}
                    href={s.href}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-all hover:shadow-sm group"
                    style={{
                      color: '#374151',
                      borderColor: '#d4d4cc',
                      background: '#ffffff',
                    }}
                  >
                    <span style={{ color: '#6b7280' }} className="group-hover:text-gray-900 transition-colors">
                      {s.icon}
                    </span>
                    {s.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Stats rapides */}
            <div className="mt-10 flex items-center gap-8">
              {[
                { n: '2 000+', label: 'Annonces' },
                { n: '14', label: 'Villes' },
                { n: '98%', label: 'Satisfaction' },
              ].map(s => (
                <div key={s.label}>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: '#0D1B3E', letterSpacing: '-0.02em' }}
                  >
                    {s.n}
                  </div>
                  <div
                    className="text-xs font-medium uppercase tracking-wider mt-0.5"
                    style={{ color: '#9ca3af' }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ─── Colonne droite : photo ──────────────────────────────── */}
          <div
            className="relative hidden lg:block"
            style={{ height: '480px' }}
          >
            {/* Photo principale */}
            <div
              className="absolute inset-0 rounded-3xl overflow-hidden shadow-2xl"
              style={{
                backgroundImage: "url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&q=85')",
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              aria-hidden="true"
            />

            {/* Badge flottant prix */}
            <div
              className="absolute bottom-6 left-6 rounded-2xl px-5 py-4 shadow-xl"
              style={{
                background: 'rgba(255,255,255,0.96)',
                backdropFilter: 'blur(12px)',
                border: '1px solid #e8e8e2',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center"
                  style={{ background: '#f4f4f0' }}
                >
                  <svg className="h-5 w-5" style={{ color: '#0D1B3E' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-medium" style={{ color: '#9ca3af' }}>Bien du moment</div>
                  <div className="text-sm font-bold" style={{ color: '#0D1B3E' }}>Villa Almadies · 250M FCFA</div>
                </div>
              </div>
            </div>

            {/* Badge vérifié */}
            <div
              className="absolute top-6 right-6 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-lg"
              style={{
                background: 'rgba(212,175,55,0.12)',
                border: '1px solid rgba(212,175,55,0.3)',
                color: '#F59E0B',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: '#F59E0B' }} />
              Vérifié Kërjom
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
