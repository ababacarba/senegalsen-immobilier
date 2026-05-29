// Hérite de RootLayout. "(public)" n'apparaît pas dans l'URL.

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col">
      {/* Sprint 2 : <PublicHeader /> */}
      <main className="flex-1" id="main-content">
        {children}
      </main>
      {/* Sprint 2 : <PublicFooter /> */}
    </div>
  )
}
