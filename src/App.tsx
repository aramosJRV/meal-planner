import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import Home from '@/screens/Home'
import ImportRecipe from '@/screens/ImportRecipe'
import Onboarding from '@/screens/Onboarding'
import RecipeDetail from '@/screens/RecipeDetail'
import RecipeEdit from '@/screens/RecipeEdit'
import RecipeForm from '@/screens/RecipeForm'
import { emptyDraft } from '@/screens/recipeData'
import RecipeLibrary from '@/screens/RecipeLibrary'
import Screen from '@/screens/Screen'
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

// Hash routes (#/recipes/…) so the back button works without a router dependency.
function useRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.startsWith('#/') ? hash.slice(2).split('/') : []
}

function Routes(props: { household: { id: string; name: string }; userId: string }) {
  const householdId = props.household.id
  const [section, id, action] = useRoute()
  if (section !== 'recipes') return <Home {...props} />
  if (!id) return <RecipeLibrary householdId={householdId} />
  if (id === 'new')
    return (
      <Screen title="Add recipe" back="#/recipes">
        <RecipeForm householdId={householdId} initial={emptyDraft} />
      </Screen>
    )
  if (id === 'import') return <ImportRecipe householdId={householdId} />
  if (action === 'edit') return <RecipeEdit key={id} id={id} householdId={householdId} />
  return <RecipeDetail key={id} id={id} householdId={householdId} />
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
  if (!household) return <Onboarding />
  return <Routes household={household} userId={session.user.id} />
}
