import type { ReactNode } from 'react'

const TABS = [
  { key: 'week', label: 'This week', href: '#/' },
  { key: 'list', label: 'Shopping', href: '#/list' },
  { key: 'recipes', label: 'Recipes', href: '#/recipes' },
  { key: 'settings', label: 'Settings', href: '#/settings' },
] as const

// With `back`, the screen is a content page: top-aligned with a back link.
// With `nav`, it's a top-level screen with the text-only tab bar (bottom on phones, top on wide
// screens). With `wide`, the page uses the full width of a computer screen.
export default function Screen({
  title,
  back,
  nav,
  wide,
  children,
}: {
  title: string
  back?: string
  nav?: (typeof TABS)[number]['key']
  wide?: boolean
  children: ReactNode
}) {
  return (
    <>
      <main
        className={`mx-auto flex min-h-svh max-w-md flex-col gap-6 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] ${nav ? 'pb-28 lg:pt-[calc(5rem+env(safe-area-inset-top))] lg:pb-12' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]'} ${back || nav ? 'justify-start' : 'justify-center'} ${wide ? 'lg:max-w-7xl 2xl:max-w-[96rem]' : ''}`}
      >
        {back && (
          <a
            href={back}
            className="text-muted-foreground flex min-h-11 items-center text-xs font-semibold tracking-[0.14em] uppercase hover:text-foreground"
          >
            ← Back
          </a>
        )}
        <h1 className="border-foreground border-b-[1.5px] pb-4 font-serif text-5xl leading-[0.95] tracking-tight">
          {title}
        </h1>
        {children}
      </main>
      {nav && (
        <nav className="bg-background fixed inset-x-0 bottom-0 border-t pb-[env(safe-area-inset-bottom)] lg:top-0 lg:bottom-auto lg:border-t-0 lg:border-b lg:pt-[env(safe-area-inset-top)] lg:pb-0">
          <ul
            role="list"
            className="mx-auto flex max-w-md justify-around lg:max-w-7xl lg:justify-start lg:gap-8 lg:px-4 2xl:max-w-[96rem]"
          >
            {TABS.map((t) => (
              <li key={t.key}>
                <a
                  href={t.href}
                  aria-current={t.key === nav ? 'page' : undefined}
                  className={`flex min-h-14 items-center border-b-2 px-2 text-xs font-semibold tracking-[0.14em] uppercase ${t.key === nav ? 'border-highlight text-foreground' : 'text-muted-foreground border-transparent'}`}
                >
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  )
}
