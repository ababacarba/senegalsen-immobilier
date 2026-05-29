import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Prix Immobilier au Sénégal — Tendances & Statistiques',
  description: 'Consultez les prix de l\'immobilier par ville et quartier au Sénégal. Tendances du marché, évolution des prix, statistiques.',
}

const CITIES = [
  { city: 'Dakar — Plateau',    price: '850 000', unit: 'FCFA/m²', trend: '+5%' },
  { city: 'Dakar — Almadies',   price: '780 000', unit: 'FCFA/m²', trend: '+3%' },
  { city: 'Dakar — Mermoz',     price: '620 000', unit: 'FCFA/m²', trend: '+4%' },
  { city: 'Dakar — Sacré-Cœur', price: '580 000', unit: 'FCFA/m²', trend: '+2%' },
  { city: 'Thiès — Centre',     price: '180 000', unit: 'FCFA/m²', trend: '+6%' },
  { city: 'Mbour',              price: '150 000', unit: 'FCFA/m²', trend: '+8%' },
]

export default function PrixImmobilierPage() {
  return (
    <div style={{ background: '#fafaf8', minHeight: '100vh' }}>

      {/* Hero */}
      <div style={{ background: '#0D1B3E', padding: '80px 0 64px' }}>
        <div className="container-page text-center">
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 999, padding: '6px 16px', marginBottom: 24,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: '#F59E0B', textTransform: 'uppercase' }}>
              Données indicatives 2026
            </span>
          </div>
          <h1 style={{ fontSize: 48, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 20 }}>
            Prix de l'immobilier<br />
            <span style={{ color: '#F59E0B' }}>au Sénégal</span>
          </h1>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.65)', maxWidth: 520, margin: '0 auto' }}>
            Tendances du marché, prix médians par quartier et évolution sur 12 mois.
          </p>
        </div>
      </div>

      {/* Tableau des prix */}
      <div className="container-page" style={{ padding: '64px 0' }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#0D1B3E', marginBottom: 8, letterSpacing: '-0.02em' }}>
          Prix médians — Vente
        </h2>
        <p style={{ fontSize: 14, color: '#9ca3af', marginBottom: 32 }}>
          Prix indicatifs basés sur les annonces Kërjom. Données mises à jour mensuellement.
        </p>

        <div style={{ background: '#FFFFFF', border: '1px solid #e8e8e2', borderRadius: 16, overflow: 'hidden' }}>
          {CITIES.map((row, idx) => (
            <div
              key={row.city}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '18px 24px',
                borderBottom: idx < CITIES.length - 1 ? '1px solid #f4f4f0' : 'none',
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#0D1B3E' }}>{row.city}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0D1B3E' }}>{row.price}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>{row.unit}</div>
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: '#1a7d52',
                  background: '#f0faf5', border: '1px solid #b5e5ce',
                  padding: '4px 10px', borderRadius: 999,
                }}>
                  {row.trend} / an
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <p style={{ fontSize: 14, color: '#9ca3af', marginBottom: 16 }}>
            Carte interactive et données détaillées — bientôt disponibles.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/annonces?type=vente" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0D1B3E', color: '#FFFFFF', padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Voir les biens à vendre
            </Link>
            <Link href="/estimer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#FFFFFF', color: '#0D1B3E', border: '1.5px solid #0D1B3E', padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Estimer mon bien
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
