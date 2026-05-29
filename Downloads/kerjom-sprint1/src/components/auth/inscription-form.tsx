'use client'

import * as React from 'react'
import Link from 'next/link'
import { signUpAction, type AuthState } from '@/domains/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

// ─── État initial ─────────────────────────────────────────────────────────────

const initialState: AuthState = { status: 'idle' }

// ─── Composant ────────────────────────────────────────────────────────────────

export function InscriptionForm() {
  const [state, setState] = React.useState<AuthState>({ status: 'idle' })
const [isPending, setIsPending] = React.useState(false)

async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault()
  setIsPending(true)
  const formData = new FormData(e.currentTarget)
  const result = await signUpAction({ status: 'idle' }, formData)
  setState(result)
  setIsPending(false)
}

  // ─── Succès ─────────────────────────────────────────────────────────────

  if (state.status === 'success') {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 ring-8 ring-brand-50/50">
            <svg
              className="h-7 w-7 text-brand-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <CardTitle>Vérifiez votre email</CardTitle>
          <CardDescription className="text-center">
            Un lien d'activation vous a été envoyé.
            <br />
            Cliquez dessus pour activer votre compte.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground">
            Pas d'email reçu ? Vérifiez vos spams ou{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-primary underline-offset-4 hover:underline"
            >
              réessayez
            </button>
            .
          </p>
        </CardContent>
      </Card>
    )
  }

  // ─── Formulaire ─────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Créer un compte</CardTitle>
        <CardDescription>
          Gratuit · Sans mot de passe · Lien de connexion par email.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            name="fullName"
            type="text"
            label="Nom complet"
            placeholder="Fatou Diallo"
            autoComplete="name"
            required
            disabled={isPending}
          />

          <Input
            name="email"
            type="email"
            label="Adresse email"
            placeholder="vous@exemple.com"
            autoComplete="email"
            required
            disabled={isPending}
            error={state.status === 'error' ? state.message : undefined}
          />

          <Button type="submit" className="w-full" size="lg" loading={isPending}>
            Créer mon compte gratuitement
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          En vous inscrivant, vous acceptez nos{' '}
          <Link href="/cgu" className="underline-offset-4 hover:underline">
            CGU
          </Link>{' '}
          et notre{' '}
          <Link href="/confidentialite" className="underline-offset-4 hover:underline">
            politique de confidentialité
          </Link>
          .
        </p>

        <p className="text-center text-sm text-muted-foreground">
          Déjà un compte ?{' '}
          <Link
            href="/connexion"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Se connecter
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
