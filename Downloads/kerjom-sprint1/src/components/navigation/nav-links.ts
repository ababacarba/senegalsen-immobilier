export interface NavLink {
  label: string
  href: string
  description?: string
  role?: 'user' | 'admin'
  badge?: string
}

export const publicNavLinks: NavLink[] = [
  { label: 'Acheter',    href: '/annonces?type=vente',    description: 'Biens à vendre' },
  { label: 'Louer',      href: '/annonces?type=location', description: 'Biens à louer' },
  { label: 'Emprunter',  href: '/emprunter',              description: 'Simulateur de crédit' },
  { label: 'Prix immo',  href: '/prix-immobilier',        description: 'Tendances du marché' },
]

export const dashboardNavLinks: NavLink[] = [
  { label: 'Tableau de bord', href: '/compte' },
  { label: 'Mes annonces',    href: '/compte/annonces' },
  { label: 'Favoris',         href: '/compte/favoris' },
  { label: 'Messages',        href: '/compte/messages' },
  { label: 'Paramètres',      href: '/compte/parametres' },
]

export const adminNavLinks: NavLink[] = [
  ...dashboardNavLinks,
  { label: 'Modération',    href: '/compte/admin/moderation',   role: 'admin' },
  { label: 'Utilisateurs',  href: '/compte/admin/utilisateurs', role: 'admin' },
  { label: 'Statistiques',  href: '/compte/admin/statistiques', role: 'admin' },
]

export function getNavLinksForRole(role: 'user' | 'admin'): NavLink[] {
  return role === 'admin' ? adminNavLinks : dashboardNavLinks
}
