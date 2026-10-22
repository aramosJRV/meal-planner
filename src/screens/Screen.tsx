import type { ReactNode } from 'react'

// With `back`, the screen is a content page: top-aligned with a back link.
export default function Screen({
  title,
  back,
  children,
}: {
  title: string
  back?: string
  children: ReactNode
}) {
  return (
    <main
      className={`mx-auto flex min-h-svh max-w-md flex-col gap-6 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] ${back ? 'justify-start' : 'justify-center'}`}
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
  )
}
