'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthState = {
  status: 'idle' | 'success' | 'error'
  message?: string
}

// ─── Schemas Zod ─────────────────────────────────────────────────────────────

const emailSchema = z.object({
  email: z.string().email('Adresse email invalide'),
})

const signupSchema = z.object({
  fullName: z
    .string()
    .min(2, 'Le nom doit faire au moins 2 caractères')
    .max(100, 'Le nom est trop long'),
  email: z.string().email('Adresse email invalide'),
})

// ─── Sign in — Magic Link ─────────────────────────────────────────────────────

/**
 * Envoie un magic link à l'email fourni.
 * Compatible useActionState (React 19) : signature (prevState, formData).
 */
export async function signInAction(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = emailSchema.safeParse({
    email: formData.get('email'),
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.errors[0]?.message ?? 'Email invalide',
    }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/compte`,
      // Ne pas créer d'utilisateur si inexistant (connexion ≠ inscription)
      shouldCreateUser: false,
    },
  })

  if (error) {
    // "Email not found" → l'utilisateur n'a pas de compte
    if (error.message.includes('not found') || error.status === 400) {
      return {
        status: 'error',
        message: 'Aucun compte trouvé pour cet email. Inscrivez-vous d\'abord.',
      }
    }
    console.error('[signInAction]', error.message)
    return {
      status: 'error',
      message: 'Impossible d\'envoyer le lien. Réessayez dans quelques instants.',
    }
  }

  return { status: 'success' }
}

// ─── Sign up — Magic Link + metadata ─────────────────────────────────────────

/**
 * Crée un compte et envoie un magic link.
 * Le profil est créé automatiquement via le trigger Supabase (migration 0001).
 */
export async function signUpAction(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.errors[0]?.message ?? 'Données invalides',
    }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      data: {
        full_name: parsed.data.fullName,
        role: 'user',
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/compte`,
      shouldCreateUser: true,
    },
  })

  if (error) {
    console.error('[signUpAction] FULL ERROR:', JSON.stringify(error))
    return {
      status: 'error',
      message: 'Impossible de créer le compte. Réessayez.',
    }
  }

  return { status: 'success' }
}

// ─── Sign out ─────────────────────────────────────────────────────────────────

/**
 * Déconnecte l'utilisateur et redirige vers /.
 * Peut être utilisée comme action de formulaire dans les Client Components.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
