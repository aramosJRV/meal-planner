import { Button } from '@/components/ui/button'

export default function App() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">Meal Planner</h1>
      <p className="text-muted-foreground">Plan your week, shop once. Coming soon.</p>
      <Button disabled>Get started</Button>
    </main>
  )
}
