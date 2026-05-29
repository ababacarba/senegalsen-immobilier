// src/app/(dashboard)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Double sécurité avec le middleware
  if (!user) {
    redirect('/connexion')
  }

  return (
    <div className="flex min-h-svh">
      {/* Sprint 2 : <DashboardSidebar user={user} /> */}
      <main className="flex-1 p-6" id="main-content">
        {children}
      </main>
    </div>
  )
}
