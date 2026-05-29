'use client'

import * as React from 'react'
import Link from 'next/link'

const PROPERTY_TYPES = ['Appartement', 'Maison', 'Villa', 'Terrain', 'Bureau', 'Commerce', 'Immeuble']
const CITIES = ['Dakar — Plateau', 'Dakar — Almadies', 'Dakar — Mermoz', 'Dakar — Sacré-Cœur', 'Dakar — Ouakam', 'Dakar — Grand Yoff', 'Thiès', 'Saint-Louis', 'Mbour', 'Ziguinchor', 'Kaolack', 'Autre']
const CONDITIONS = ['Neuf / livraison récente', 'Bon état', 'État correct', 'À rénover']
const TRANSACTION = ['Vente', 'Location']

const STEPS = [
  { num: '01', title: 'Votre bien', desc: 'Type, localisation, surface' },
  { num: '02', title: 'Détails', desc: 'État, équipements, pièces' },
  { num: '03', title: 'Vos coordonnées', desc: 'Pour recevoir l\'estimation' },
]

type FormData = {
  transaction: string
  type: string
  city: string
  neighborhood: string
  surface: string
  rooms: string
  condition: string
  hasParking: boolean
  hasPool: boolean
  hasGarden: boolean
  floors: string
  description: string
  name: string
  email: string
  phone: string
}

const INITIAL: FormData = {
  transaction: '', type: '', city: '', neighborhood: '', surface: '',
  rooms: '', condition: '', hasParking: false, hasPool: false, hasGarden: false,
  floors: '', description: '', name: '', email: '', phone: '',
}

export default function EstimerPage() {
  const [step, setStep] = React.useState(1)
  const [form, setForm] = React.useState<FormData>(INITIAL)
  const [submitted, setSubmitted] = React.useState(false)

  function update(field: keyof FormData, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function canNext() {
    if (step === 1) return form.transaction && form.type && form.city && form.surface
    if (step === 2) return form.condition
    if (step === 3) return form.name && form.email
    return false
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const body = `Bonjour l'équipe Kërjom,

Je souhaite obtenir une estimation pour le bien suivant :

📍 LOCALISATION
Type de transaction : ${form.transaction}
Type de bien : ${form.type}
Ville / Quartier : ${form.city}${form.neighborhood ? ` — ${form.neighborhood}` : ''}

📐 CARACTÉRISTIQUES
Surface : ${form.surface} m²
Nombre de pièces : ${form.rooms || 'Non précisé'}
Étage(s) : ${form.floors || 'Non précisé'}
État général : ${form.condition}
Parking : ${form.hasParking ? 'Oui' : 'Non'}
Piscine : ${form.hasPool ? 'Oui' : 'Non'}
Jardin : ${form.hasGarden ? 'Oui' : 'Non'}

📝 DESCRIPTION COMPLÉMENTAIRE
${form.description || 'Aucune'}

👤 MES COORDONNÉES
Nom : ${form.name}
Email : ${form.email}
Téléphone : ${form.phone || 'Non précisé'}

Merci de me contacter avec une estimation sous 24h.`

    const mailto = `mailto:estimation@kerjom.com?subject=Demande d'estimation — ${form.type} ${form.city}&body=${encodeURIComponent(body)}`
    window.open(mailto)
    setSubmitted(true)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1.5px solid #e8e8e2', borderRadius: 10,
    padding: '12px 14px', fontSize: 14, color: '#0D1B3E',
    background: '#fafaf8', outline: 'none', transition: 'border-color 200ms',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 600,
    color: '#374151', marginBottom: 6, letterSpacing: '0.01em',
  }

  if (submitted) {
    return (
      <div style={{ background: '#fafaf8', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#FFFFFF', border: '1px solid #e8e8e2', borderRadius: 20, padding: 48, maxWidth: 480, textAlign: 'center', margin: '0 20px' }}>
          <div style={{ fontSize: 56, marginBottom: 20 }}>✅</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#0D1B3E', marginBottom: 12 }}>Demande envoyée !</h2>
          <p style={{ fontSize: 15, color: '#6b7280', lineHeight: 1.65, marginBottom: 28 }}>
            Votre client email s'est ouvert avec toutes les informations. Notre équipe vous contactera sous 24h avec une estimation personnalisée.
          </p>
          <Link href="/" style={{ display: 'inline-flex', background: '#3B82F6', color: '#FFFFFF', padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Retour à l'accueil
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#fafaf8', minHeight: '100vh' }}>
      {/* Hero */}
      <div style={{ background: '#0D1B3E', padding: '60px 0 48px' }}>
        <div className="container-page text-center">
          <h1 style={{ fontSize: 40, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 16 }}>
            Combien vaut <span style={{ color: '#3B82F6' }}>votre bien ?</span>
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.65)', maxWidth: 480, margin: '0 auto' }}>
            Remplissez ce formulaire et recevez une estimation personnalisée sous 24h — gratuit et sans engagement.
          </p>

          {/* Étapes */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 0, marginTop: 40 }}>
            {STEPS.map((s, idx) => (
              <div key={s.num} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', margin: '0 auto 6px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700,
                    background: step > idx + 1 ? '#3B82F6' : step === idx + 1 ? '#FFFFFF' : 'rgba(255,255,255,0.15)',
                    color: step > idx + 1 ? '#FFFFFF' : step === idx + 1 ? '#0D1B3E' : 'rgba(255,255,255,0.4)',
                    border: step === idx + 1 ? 'none' : 'none',
                  }}>
                    {step > idx + 1 ? '✓' : s.num}
                  </div>
                  <div style={{ fontSize: 11, color: step === idx + 1 ? '#FFFFFF' : 'rgba(255,255,255,0.4)', fontWeight: step === idx + 1 ? 600 : 400 }}>
                    {s.title}
                  </div>
                </div>
                {idx < STEPS.length - 1 && (
                  <div style={{ width: 60, height: 1, background: 'rgba(255,255,255,0.2)', margin: '0 8px 20px' }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Formulaire */}
      <div className="container-page" style={{ padding: '48px 0 64px' }}>
        <form onSubmit={handleSubmit}>
          <div style={{ background: '#FFFFFF', border: '1px solid #e8e8e2', borderRadius: 20, padding: 40, maxWidth: 680, margin: '0 auto', boxShadow: '0 4px 24px rgba(13,27,62,0.06)' }}>

            {/* ─── Étape 1 ─────────────────────────────────────── */}
            {step === 1 && (
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0D1B3E', marginBottom: 28 }}>Votre bien</h2>

                {/* Transaction */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Type de transaction *</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {TRANSACTION.map(t => (
                      <button key={t} type="button" onClick={() => update('transaction', t)}
                        style={{ flex: 1, padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 200ms', border: '1.5px solid', borderColor: form.transaction === t ? '#3B82F6' : '#e8e8e2', background: form.transaction === t ? '#EFF6FF' : '#FFFFFF', color: form.transaction === t ? '#3B82F6' : '#6b7280' }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Type */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Type de bien *</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                    {PROPERTY_TYPES.map(t => (
                      <button key={t} type="button" onClick={() => update('type', t)}
                        style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1.5px solid', borderColor: form.type === t ? '#3B82F6' : '#e8e8e2', background: form.type === t ? '#EFF6FF' : '#FFFFFF', color: form.type === t ? '#3B82F6' : '#6b7280' }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ville */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Ville / Zone *</label>
                  <select value={form.city} onChange={e => update('city', e.target.value)} style={inputStyle} required>
                    <option value="">Sélectionner...</option>
                    {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* Quartier */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Quartier précis</label>
                  <input type="text" value={form.neighborhood} onChange={e => update('neighborhood', e.target.value)} placeholder="Ex: Cité Keur Gorgui, Liberté 6..." style={inputStyle} />
                </div>

                {/* Surface */}
                <div style={{ marginBottom: 8 }}>
                  <label style={labelStyle}>Surface habitable (m²) *</label>
                  <input type="number" value={form.surface} onChange={e => update('surface', e.target.value)} placeholder="Ex: 120" min="1" style={inputStyle} required />
                </div>
              </div>
            )}

            {/* ─── Étape 2 ─────────────────────────────────────── */}
            {step === 2 && (
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0D1B3E', marginBottom: 28 }}>Détails du bien</h2>

                {/* État */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>État général *</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {CONDITIONS.map(c => (
                      <button key={c} type="button" onClick={() => update('condition', c)}
                        style={{ padding: '12px', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left', border: '1.5px solid', borderColor: form.condition === c ? '#3B82F6' : '#e8e8e2', background: form.condition === c ? '#EFF6FF' : '#FFFFFF', color: form.condition === c ? '#3B82F6' : '#374151' }}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pièces + Étages */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                  <div>
                    <label style={labelStyle}>Nombre de pièces</label>
                    <input type="number" value={form.rooms} onChange={e => update('rooms', e.target.value)} placeholder="Ex: 4" min="1" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Étage(s)</label>
                    <input type="text" value={form.floors} onChange={e => update('floors', e.target.value)} placeholder="Ex: R+2, RDC..." style={inputStyle} />
                  </div>
                </div>

                {/* Équipements */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Équipements</label>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[
                      { key: 'hasParking', label: '🚗 Parking' },
                      { key: 'hasPool', label: '🏊 Piscine' },
                      { key: 'hasGarden', label: '🌿 Jardin' },
                    ].map(eq => (
                      <button key={eq.key} type="button"
                        onClick={() => update(eq.key as keyof FormData, !form[eq.key as keyof FormData])}
                        style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1.5px solid', borderColor: form[eq.key as keyof FormData] ? '#3B82F6' : '#e8e8e2', background: form[eq.key as keyof FormData] ? '#EFF6FF' : '#FFFFFF', color: form[eq.key as keyof FormData] ? '#3B82F6' : '#6b7280' }}>
                        {eq.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label style={labelStyle}>Description complémentaire</label>
                  <textarea value={form.description} onChange={e => update('description', e.target.value)} placeholder="Précisez tout ce qui pourrait influencer la valeur : vue, luminosité, rénovations récentes, titre foncier..." rows={4} style={{ ...inputStyle, resize: 'none', lineHeight: 1.6 }} />
                </div>
              </div>
            )}

            {/* ─── Étape 3 ─────────────────────────────────────── */}
            {step === 3 && (
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0D1B3E', marginBottom: 8 }}>Vos coordonnées</h2>
                <p style={{ fontSize: 14, color: '#9ca3af', marginBottom: 28 }}>Pour recevoir votre estimation personnalisée sous 24h.</p>

                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Nom complet *</label>
                  <input type="text" value={form.name} onChange={e => update('name', e.target.value)} placeholder="Votre nom et prénom" style={inputStyle} required />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Adresse email *</label>
                  <input type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="votre@email.com" style={inputStyle} required />
                </div>

                <div style={{ marginBottom: 28 }}>
                  <label style={labelStyle}>Téléphone / WhatsApp</label>
                  <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="+221 77 000 00 00" style={inputStyle} />
                </div>

                {/* Récap */}
                <div style={{ background: '#F8FAFF', border: '1px solid #e8e8e2', borderRadius: 12, padding: 20, marginBottom: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Récapitulatif</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { l: 'Transaction', v: form.transaction },
                      { l: 'Type', v: form.type },
                      { l: 'Ville', v: form.city },
                      { l: 'Surface', v: `${form.surface} m²` },
                      { l: 'État', v: form.condition },
                    ].map(r => (
                      <div key={r.l}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{r.l}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1B3E' }}>{r.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, paddingTop: 24, borderTop: '1px solid #f4f4f0' }}>
              {step > 1 ? (
                <button type="button" onClick={() => setStep(s => s - 1)}
                  style={{ padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: '1.5px solid #e8e8e2', background: '#FFFFFF', color: '#374151' }}>
                  ← Retour
                </button>
              ) : <div />}

              {step < 3 ? (
                <button type="button" onClick={() => setStep(s => s + 1)} disabled={!canNext()}
                  style={{ padding: '12px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: canNext() ? 'pointer' : 'not-allowed', border: 'none', background: canNext() ? '#3B82F6' : '#e8e8e2', color: canNext() ? '#FFFFFF' : '#9ca3af', transition: 'all 200ms' }}>
                  Continuer →
                </button>
              ) : (
                <button type="submit" disabled={!canNext()}
                  style={{ padding: '12px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#3B82F6', color: '#FFFFFF' }}>
                  Envoyer ma demande ✓
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
