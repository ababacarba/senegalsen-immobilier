'use client'

import * as React from 'react'
import Link from 'next/link'
import { signInAction, type AuthState } from '@/domains/auth/actions'
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

export function ConnexionForm({ errorParam }: { errorParam?: string }) {
  const [state, setState] = React.useState<AuthState>({ status: 'idle' })
const [isPending, setIsPending] = React.useState(false)

async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault()
  setIsPending(true)
  const formData = new FormData(e.currentTarget)
  const result = await signInAction({ status: 'idle' }, formData)
  setState(result)
  setIsPending(false)
}

  // ─── Succès : email envoyé ───────────────────────────────────────────────

  if (state.status === 'success') {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 ring-8 ring-green-50/50">
            <svg
              className="h-7 w-7 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <CardTitle>Vérifiez votre email</CardTitle>
          <CardDescription className="text-center">
            Un lien de connexion a été envoyé.
            <br />
            Il est valide pendant <strong>1 heure</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">
            Pas d'email reçu ? Vérifiez vos spams.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Réessayer avec un autre email
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ─── Erreur depuis le magic link (token expiré, etc.) ───────────────────

  const linkError =
    errorParam === 'lien_invalide'
      ? 'Lien invalide ou déjà utilisé. Demandez-en un nouveau.'
      : errorParam === 'lien_expire'
      ? 'Ce lien a expiré (validité 1h). Demandez-en un nouveau.'
      : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Connexion</CardTitle>
        <CardDescription>
          Entrez votre email — nous vous envoyons un lien de connexion instantané.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Erreur lien expiré */}
        {linkError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {linkError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            Recevoir le lien de connexion
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Pas encore de compte ?{' '}
          <Link
            href="/inscription"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            S'inscrire gratuitement
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
