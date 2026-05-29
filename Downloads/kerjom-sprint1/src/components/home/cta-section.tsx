import Link from 'next/link'

export function CtaSection() {
  return (
    <section
      className="py-16 lg:py-20"
      style={{ background: '#0D1B3E' }}
      aria-labelledby="cta-title"
    >
      <div className="container-page text-center">
        <h2
          id="cta-title"
          className="text-2xl font-bold text-white sm:text-3xl"
          style={{ letterSpacing: '-0.025em' }}
        >
          Prêt à trouver votre bien idéal ?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
          Rejoignez des milliers de Sénégalais qui font confiance à Kërjom
          pour leurs projets immobiliers.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/annonces"
            className="inline-flex items-center justify-center rounded-xl px-8 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: '#3B82F6' }}
          >
            Parcourir les annonces
          </Link>
          <Link
            href="/inscription"
            className="inline-flex items-center justify-center rounded-xl px-8 py-3.5 text-sm font-semibold transition-all hover:bg-white/10"
            style={{ border: '1.5px solid rgba(255,255,255,0.35)', color: '#ffffff' }}
          >
            Publier gratuitement
          </Link>
        </div>
      </div>
    </section>
  )
}
