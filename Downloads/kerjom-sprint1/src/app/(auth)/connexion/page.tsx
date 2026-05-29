// src/app/(auth)/connexion/page.tsx
import type { Metadata } from 'next'
import { ConnexionForm } from '@/components/auth/connexion-form'

export const metadata: Metadata = {
  title: 'Connexion',
  description: 'Connectez-vous à votre compte Kërjom.',
}

interface ConnexionPageProps {
  searchParams: Promise<{ error?: string }>
}

/**
 * Server Component — lit les searchParams (erreur magic link)
 * et délègue le rendu au Client Component ConnexionForm.
 */
export default async function ConnexionPage({ searchParams }: ConnexionPageProps) {
  const { error } = await searchParams
  return <ConnexionForm errorParam={error} />
}
