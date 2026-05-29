// src/app/(dashboard)/compte/page.tsx
import { createClient } from '@/lib/supabase/server'
import { signOutAction } from '@/domains/auth/actions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export default async function ComptePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // user est garanti non-null — le layout redirige si absent
  const fullName = user?.user_metadata?.['full_name'] as string | undefined
  const role = (user?.user_metadata?.['role'] as string | undefined) ?? 'user'
  const email = user?.email ?? ''
  const initials = (fullName ?? email).slice(0, 2).toUpperCase()

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Mon compte</h1>
        <p className="mt-1 text-muted-foreground">
          Gérez votre profil et vos annonces
        </p>
      </div>

      {/* Profil */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xl font-semibold">
              {initials}
            </div>
            <div>
              <CardTitle>{fullName ?? 'Mon compte'}</CardTitle>
              <CardDescription>{email}</CardDescription>
            </div>
            <Badge variant={role === 'admin' ? 'warning' : 'secondary'} className="ml-auto">
              {role === 'admin' ? 'Admin' : 'Utilisateur'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* Signout via Server Action — pas de JS client nécessaire */}
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit">
              Se déconnecter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Stats — placeholder Sprint 5+ */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mes annonces</CardTitle>
            <CardDescription>Publiées</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">0</p>
            <Badge variant="secondary" className="mt-2">Sprint 5</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Favoris</CardTitle>
            <CardDescription>Sauvegardés</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">0</p>
            <Badge variant="secondary" className="mt-2">Sprint 6</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session</CardTitle>
            <CardDescription>Statut</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="success">Active ✓</Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
