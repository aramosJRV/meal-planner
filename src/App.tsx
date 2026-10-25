import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import ChooseMeal from '@/screens/ChooseMeal'
import GroceryList from '@/screens/GroceryList'
import ImportRecipe from '@/screens/ImportRecipe'
import Onboarding from '@/screens/Onboarding'
import type { Household } from '@/screens/planData'
import RecipeDetail from '@/screens/RecipeDetail'
import RecipeEdit from '@/screens/RecipeEdit'
import RecipeForm from '@/screens/RecipeForm'
import { emptyDraft } from '@/screens/recipeData'
import RecipeLibrary from '@/screens/RecipeLibrary'
import Screen from '@/screens/Screen'
import Settings from '@/screens/Settings'
import SignIn from '@/screens/SignIn'
import ThisWeek from '@/screens/ThisWeek'

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

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SLOT = /^(breakfast|lunch|dinner|snack)$/

function Routes(props: { household: Household; userId: string }) {
  const householdId = props.household.id
  const [section, id, action, slot] = useRoute()
  if (section === 'settings') return <Settings {...props} />
  if (section === 'list')
    return (
      <GroceryList
        key={id}
        household={props.household}
        weekStart={DATE.test(id ?? '') ? id : undefined}
      />
    )
  if (section === 'week' && DATE.test(id ?? '') && DATE.test(action ?? '') && SLOT.test(slot ?? ''))
    return (
      <ChooseMeal
        household={props.household}
        weekStart={id}
        date={action}
        slot={slot as 'dinner'}
      />
    )
  if (section !== 'recipes')
    return (
      <ThisWeek
        key={id}
        household={props.household}
        weekStart={section === 'week' && DATE.test(id ?? '') ? id : undefined}
      />
    )
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
        .select('id, name, slot_config, planner_settings, week_start_day')
        .order('created_at')
      if (error) throw error
      return data as Household[]
    },
  })

  if (session === undefined) return null
  if (!session) return <SignIn />
  if (households.isPending) return null
  // Offline with a saved copy: carry on with it rather than showing an error.
  if (households.isError && !households.data)
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
