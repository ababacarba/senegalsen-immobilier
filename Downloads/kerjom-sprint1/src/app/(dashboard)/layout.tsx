// src/app/(dashboard)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/connexion')

  // Rôle depuis user_metadata — défini à l'inscription
  const role = (user.user_metadata?.['role'] as 'user' | 'admin') ?? 'user'

  return (
    <div className="flex min-h-svh bg-background">
      <DashboardSidebar user={user} role={role} />

      {/* Contenu principal */}
      <div className="flex flex-1 flex-col min-w-0">
        <main
          className="flex-1 p-6 lg:p-8"
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
