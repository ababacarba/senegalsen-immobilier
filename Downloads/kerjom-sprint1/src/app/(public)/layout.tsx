// src/app/(public)/layout.tsx
import { PublicHeader } from '@/components/layout/public-header'
import { PublicFooter } from '@/components/layout/public-footer'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <main className="flex-1" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}
