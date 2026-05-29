import Link from 'next/link'

const footerLinks = {
  produit: [
    { label: 'Annonces', href: '/annonces' },
    { label: 'Déposer une annonce', href: '/inscription' },
    { label: 'Comment ça marche', href: '/comment-ca-marche' },
  ],
  entreprise: [
    { label: 'À propos', href: '/a-propos' },
    { label: 'Contact', href: '/contact' },
    { label: 'Blog', href: '/blog' },
  ],
  legal: [
    { label: 'Mentions légales', href: '/mentions-legales' },
    { label: 'Politique de confidentialité', href: '/confidentialite' },
    { label: 'CGU', href: '/cgu' },
  ],
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-muted/40">
      <div className="container-page py-12">
        {/* Grid principale */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="font-bold text-xl text-primary">
              Kërjom
            </Link>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              La marketplace immobilière de référence au Sénégal.
            </p>
          </div>

          {/* Produit */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Produit</h3>
            <ul className="space-y-2">
              {footerLinks.produit.map(link => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Entreprise */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Entreprise</h3>
            <ul className="space-y-2">
              {footerLinks.entreprise.map(link => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Légal */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Légal</h3>
            <ul className="space-y-2">
              {footerLinks.legal.map(link => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 md:flex-row">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Kërjom. Tous droits réservés.
          </p>
          <p className="text-xs text-muted-foreground">
            Fait avec ❤️ au Sénégal
          </p>
        </div>
      </div>
    </footer>
  )
}
