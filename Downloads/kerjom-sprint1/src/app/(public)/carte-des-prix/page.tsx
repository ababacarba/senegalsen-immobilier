import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Carte des prix immobiliers au Sénégal',
  description: 'Visualisez les prix de l\'immobilier par quartier sur la carte interactive du Sénégal. Prix au m², tendances, statistiques.',
}

const ZONES = [
  { zone: 'Plateau',     type: 'Appartements', min: '700k', max: '1 200k', color: '#ef4444' },
  { zone: 'Almadies',    type: 'Villas',        min: '600k', max: '950k',  color: '#f97316' },
  { zone: 'Mermoz',      type: 'Appartements', min: '450k', max: '700k',  color: '#F59E0B' },
  { zone: 'Sacré-Cœur',  type: 'Maisons',      min: '400k', max: '650k',  color: '#84cc16' },
  { zone: 'Ngor',        type: 'Villas',        min: '500k', max: '800k',  color: '#F59E0B' },
  { zone: 'Ouakam',      type: 'Appartements', min: '300k', max: '500k',  color: '#22c55e' },
  { zone: 'Grand Yoff',  type: 'Maisons',      min: '200k', max: '380k',  color: '#3B82F6' },
  { zone: 'Parcelles',   type: 'Maisons',      min: '180k', max: '320k',  color: '#3B82F6' },
]

export default function CarteDesPrixPage() {
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
              Carte interactive — Bientôt
            </span>
          </div>
          <h1 style={{ fontSize: 48, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 20 }}>
            Carte des prix<br />
            <span style={{ color: '#F59E0B' }}>par quartier</span>
          </h1>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.65)', maxWidth: 520, margin: '0 auto' }}>
            Visualisez les prix au m² par quartier et identifiez les meilleures opportunités immobilières au Sénégal.
          </p>
        </div>
      </div>

      <div className="container-page" style={{ padding: '64px 0' }}>

        {/* Légende couleurs */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Prix/m² :</span>
          {[
            { label: '> 700k', color: '#ef4444' },
            { label: '500k–700k', color: '#f97316' },
            { label: '350k–500k', color: '#F59E0B' },
            { label: '200k–350k', color: '#84cc16' },
            { label: '< 200k', color: '#3B82F6' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: l.color, display: 'inline-block' }} />
              <span style={{ fontSize: 13, color: '#374151' }}>{l.label} FCFA</span>
            </div>
          ))}
        </div>

        {/* Placeholder carte */}
        <div style={{
          background: '#FFFFFF', border: '1px solid #e8e8e2', borderRadius: 20,
          height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 32, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>🗺️</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#0D1B3E', marginBottom: 6 }}>Carte interactive en développement</p>
            <p style={{ fontSize: 14, color: '#9ca3af' }}>La carte Google Maps avec heatmap des prix sera disponible prochainement.</p>
          </div>
        </div>

        {/* Tableau par quartier */}
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0D1B3E', marginBottom: 20, letterSpacing: '-0.02em' }}>
          Prix par quartier — Dakar
        </h2>
        <div style={{ background: '#FFFFFF', border: '1px solid #e8e8e2', borderRadius: 16, overflow: 'hidden' }}>
          {ZONES.map((row, idx) => (
            <div key={row.zone} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 24px',
              borderBottom: idx < ZONES.length - 1 ? '1px solid #f4f4f0' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: row.color, display: 'inline-block', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#0D1B3E' }}>{row.zone}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>{row.type}</div>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
                {row.min} – {row.max} FCFA/m²
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/prix-immobilier" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0D1B3E', color: '#FFFFFF', padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Voir toutes les statistiques
            </Link>
            <Link href="/annonces" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#FFFFFF', color: '#0D1B3E', border: '1.5px solid #0D1B3E', padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Parcourir les annonces
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
