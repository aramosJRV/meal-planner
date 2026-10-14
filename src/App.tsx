import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import Home from '@/screens/Home'
import Onboarding from '@/screens/Onboarding'
import SignIn from '@/screens/SignIn'

function useSession() {
  // undefined = still checking; fires INITIAL_SESSION straight away, including after a magic-link redirect.
  const [session, setSession] = useState<Session | null>()
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

export default function App() {
  const session = useSession()
  const userId = session?.user.id
  const households = useQuery({
    queryKey: ['households', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('households')
        .select('id, name')
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  if (session === undefined) return null
  if (!session) return <SignIn />
  if (households.isPending) return null
  if (households.isError)
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6">
        <p role="alert">Couldn't load your household.</p>
        <Button onClick={() => households.refetch()}>Try again</Button>
      </main>
    )
  // TODO(v2): household switcher when a user belongs to more than one.
  const household = households.data[0]
  return household ? <Home household={household} userId={session.user.id} /> : <Onboarding />
}
