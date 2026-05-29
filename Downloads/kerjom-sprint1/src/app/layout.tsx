import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, Cormorant_Garamond, Geist_Mono } from 'next/font/google'
import './globals.css'

// ── Typographie Premium ────────────────────────────────────────────────────

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
})

const cormorantGaramond = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

// ── Metadata ──────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kerjom.com'),
  title: {
    default: 'Kërjom — L\'immobilier d\'exception au Sénégal',
    template: '%s | Kërjom',
  },
  description:
    'Découvrez les plus belles propriétés à vendre et à louer au Sénégal. Appartements, villas, terrains — un service immobilier d\'excellence.',
  openGraph: {
    type: 'website',
    locale: 'fr_SN',
    siteName: 'Kërjom',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0D1B3E',
}

// ── Layout ────────────────────────────────────────────────────────────────

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${plusJakartaSans.variable} ${cormorantGaramond.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
