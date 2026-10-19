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
      className={`mx-auto flex min-h-svh max-w-md flex-col gap-6 p-6 ${back ? 'justify-start' : 'justify-center'}`}
    >
      {back && (
        <a href={back} className="text-muted-foreground text-sm hover:underline">
          ← Back
        </a>
      )}
      <h1 className="text-3xl font-semibold">{title}</h1>
      {children}
    </main>
  )
}
