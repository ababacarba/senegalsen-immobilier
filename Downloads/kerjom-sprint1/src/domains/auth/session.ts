import { createClient } from '@/lib/supabase/server'
import { cache } from 'react'

/**
 * Récupère l'utilisateur courant — dédupliqué par React.cache().
 * Appeler dans n'importe quel Server Component sans surcoût réseau.
 */
export const getUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

/** Guard Server Action — throw si non authentifié */
export async function requireAuth() {
  const user = await getUser()
  if (!user) throw new Error('Non authentifié')
  return user
}

/** Guard Server Action — throw si non admin */
export async function requireAdmin() {
  const user = await requireAuth()
  const role = user.user_metadata?.['role'] as string | undefined
  if (role !== 'admin') throw new Error('Accès refusé')
  return user
}
