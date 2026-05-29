'use client'

import * as React from 'react'
import Link from 'next/link'

function formatFCFA(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA'
}

const BANKS = [
  { name: 'Banque de l\'Habitat du Sénégal', rate: 8.5, max: 25 },
  { name: 'SGBS', rate: 9.0, max: 20 },
  { name: 'CBAO', rate: 9.5, max: 20 },
  { name: 'Ecobank Sénégal', rate: 10.0, max: 15 },
]

export default function EmprunterPage() {
  const [montant, setMontant] = React.useState(25000000)
  const [duree, setDuree] = React.useState(15)
  const [taux, setTaux] = React.useState(9)
  const [apport, setApport] = React.useState(0)

  const principal = montant - apport
  const tauxMensuel = taux / 100 / 12
  const n = duree * 12
  const mensualite = principal > 0 && tauxMensuel > 0
    ? principal * (tauxMensuel * Math.pow(1 + tauxMensuel, n)) / (Math.pow(1 + tauxMensuel, n) - 1)
    : 0
  const totalRembourse = mensualite * n
  const coutCredit = totalRembourse - principal
  const tauxEndettement = 35 // recommandation max

  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1.5px solid #e8e8e2', borderRadius: 10,
    padding: '12px 14px', fontSize: 15, fontWeight: 600, color: '#0D1B3E',
    background: '#fafaf8', outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: '#374151',
    marginBottom: 6, display: 'block', letterSpacing: '0.01em',
  }

  const revenuRequis = mensualite / (tauxEndettement / 100)

  return (
    <div style={{ background: '#fafaf8', minHeight: '100vh' }}>
      {/* Hero */}
      <div style={{ background: '#0D1B3E', padding: '60px 0 48px' }}>
        <div className="container-page text-center">
          <h1 style={{ fontSize: 40, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 16 }}>
            Simulez votre <span style={{ color: '#3B82F6' }}>crédit immobilier</span>
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.65)', maxWidth: 500, margin: '0 auto' }}>
            Calculez vos mensualités, le coût total de votre crédit et votre capacité d'emprunt.
          </p>
        </div>
      </div>

      <div className="container-page" style={{ padding: '48px 0 64px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 960, margin: '0 auto' }}>

          {/* ─── Formulaire ──────────────────────────────────── */}
          <div style={{ background: '#FFFFFF', border: '1px solid #e8e8e2', borderRadius: 20, padding: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0D1B3E', marginBottom: 28 }}>Paramètres du prêt</h2>

            {/* Prix du bien */}
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Prix du bien</label>
              <input type="number" value={montant} onChange={e => setMontant(Number(e.target.value))} min={1000000} step={500000} style={inputStyle} />
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{formatFCFA(montant)}</div>
            </div>

            {/* Apport */}
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Apport personnel</label>
              <input type="number" value={apport} onChange={e => setApport(Number(e.target.value))} min={0} step={500000} max={montant} style={inputStyle} />
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                {formatFCFA(apport)} ({montant > 0 ? Math.round(apport / montant * 100) : 0}% du prix)
              </div>
            </div>

            {/* Durée */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Durée du prêt</label>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#3B82F6' }}>{duree} ans</span>
              </div>
              <input type="range" value={duree} onChange={e => setDuree(Number(e.target.value))} min={5} max={25} step={1}
                style={{ width: '100%', accentColor: '#3B82F6' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                <span>5 ans</span><span>25 ans</span>
              </div>
            </div>

            {/* Taux */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Taux d'intérêt annuel</label>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#3B82F6' }}>{taux}%</span>
              </div>
              <input type="range" value={taux} onChange={e => setTaux(Number(e.target.value))} min={5} max={15} step={0.5}
                style={{ width: '100%', accentColor: '#3B82F6' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                <span>5%</span><span>15%</span>
              </div>
            </div>
          </div>

          {/* ─── Résultats ───────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Mensualité */}
            <div style={{ background: '#0D1B3E', borderRadius: 20, padding: 28, textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Mensualité estimée
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, color: '#3B82F6', letterSpacing: '-0.03em' }}>
                {formatFCFA(mensualite)}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
                pendant {duree} ans ({n} mensualités)
              </div>
            </div>

            {/* Détails */}
            <div style={{ background: '#FFFFFF', border: '1px solid #e8e8e2', borderRadius: 16, padding: 24 }}>
              {[
                { label: 'Montant emprunté', value: formatFCFA(principal), color: '#0D1B3E' },
                { label: 'Total remboursé', value: formatFCFA(totalRembourse), color: '#0D1B3E' },
                { label: 'Coût du crédit', value: formatFCFA(coutCredit), color: '#ef4444' },
                { label: 'Revenu mensuel requis (35%)', value: formatFCFA(revenuRequis), color: '#F59E0B' },
              ].map((row, idx, arr) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: idx < arr.length - 1 ? 14 : 0, marginBottom: idx < arr.length - 1 ? 14 : 0, borderBottom: idx < arr.length - 1 ? '1px solid #f4f4f0' : 'none' }}>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>{row.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>

            {/* Répartition visuelle */}
            <div style={{ background: '#FFFFFF', border: '1px solid #e8e8e2', borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Répartition du remboursement</div>
              <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ flex: principal, background: '#3B82F6' }} />
                <div style={{ flex: coutCredit, background: '#FEE2E2' }} />
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#3B82F6', display: 'inline-block' }} />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>Capital ({Math.round(principal / totalRembourse * 100)}%)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#FEE2E2', display: 'inline-block' }} />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>Intérêts ({Math.round(coutCredit / totalRembourse * 100)}%)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Banques partenaires */}
        <div style={{ maxWidth: 960, margin: '32px auto 0' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0D1B3E', marginBottom: 16, letterSpacing: '-0.02em' }}>
            Taux du marché sénégalais
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {BANKS.map(bank => (
              <div key={bank.name} style={{ background: '#FFFFFF', border: bank.rate === taux ? '1.5px solid #3B82F6' : '1px solid #e8e8e2', borderRadius: 12, padding: 16, cursor: 'pointer' }}
                onClick={() => { setTaux(bank.rate); setDuree(Math.min(duree, bank.max)) }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1B3E', marginBottom: 6 }}>{bank.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9ca3af' }}>
                  <span>Taux : <strong style={{ color: '#3B82F6' }}>{bank.rate}%</strong></span>
                  <span>Max : {bank.max} ans</span>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 12 }}>
            * Taux indicatifs. Cliquez sur une banque pour l'appliquer au simulateur. Contactez les établissements pour les taux personnalisés.
          </p>
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <Link href="/annonces" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0D1B3E', color: '#FFFFFF', padding: '12px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Voir les biens dans votre budget →
          </Link>
        </div>
      </div>
    </div>
  )
}
