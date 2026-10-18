import type { ReactNode } from 'react'

export default function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold">{title}</h1>
      {children}
    </main>
  )
}
