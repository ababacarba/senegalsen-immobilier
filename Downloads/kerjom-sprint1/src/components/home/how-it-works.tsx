const STEPS = [
  {
    number: '01',
    title: 'Créez votre compte',
    description: 'Inscription gratuite en 30 secondes. Aucun mot de passe — juste votre email.',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Publiez votre annonce',
    description: 'Photos, description, prix. Votre bien est en ligne en quelques minutes.',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Recevez des contacts',
    description: 'Les acheteurs et locataires vous contactent directement via WhatsApp.',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
  },
]

export function HowItWorks() {
  return (
    <section className="bg-white py-16 lg:py-20" aria-labelledby="how-title">
      <div className="container-page">
        <div className="mb-12 text-center">
          <h2 id="how-title" className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Comment ça marche
          </h2>
          <p className="mt-3 text-gray-500">
            Publier ou trouver un bien immobilier n'a jamais été aussi simple.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((step, idx) => (
            <div key={step.number} className="relative text-center">
              {/* Connecteur entre étapes */}
              {idx < STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  className="absolute left-1/2 top-8 hidden h-0.5 w-full translate-x-8 bg-gray-100 md:block"
                />
              )}

              {/* Icône */}
              <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                {step.icon}
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  {idx + 1}
                </span>
              </div>

              <h3 className="mb-2 text-lg font-semibold text-gray-900">{step.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
