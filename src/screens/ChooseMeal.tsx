import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { SLOTS, type Slot } from '@/lib/planner'
import { go, useRecipes } from './recipeData'
import {
  dayLabel,
  type Entry,
  type Household,
  PlanError,
  setSlot,
  usePlanChange,
  useWeek,
} from './planData'
import Screen from './Screen'

const label = 'text-highlight text-xs font-bold tracking-[0.16em] uppercase'
const row = 'flex w-full flex-col py-3 text-left hover:underline disabled:opacity-50'
// One column on phone; two or three on wide screens.
const grid =
  'border-foreground flex flex-col divide-y border-t-[1.5px] lg:grid lg:grid-cols-2 lg:gap-x-12 lg:divide-y-0 xl:grid-cols-3'

// Pick a recipe (or leftovers of an earlier meal) for one slot of the week.
export default function ChooseMeal(p: {
  household: Household
  weekStart: string
  date: string
  slot: Slot
}) {
  const back = `#/week/${p.weekStart}`
  const recipes = useRecipes(p.household.id)
  const week = useWeek(p.household.id, p.weekStart)
  const [search, setSearch] = useState('')
  const current = week.data?.find((e) => e.date === p.date && e.slot === p.slot)
  const choose = usePlanChange(p.household.id, p.weekStart, setSlot)
  // Turning a cooked meal into leftovers removes the leftovers planned from it.
  const losesLeftovers = (leftoverOf?: Entry) =>
    !!leftoverOf &&
    !!current &&
    !current.leftover_of &&
    !!week.data?.some((e) => e.leftover_of === current.id)
  const pick = (recipe: { id: string; base_servings: number }, leftoverOf?: Entry) =>
    (!losesLeftovers(leftoverOf) ||
      window.confirm('This also removes the leftovers planned from this meal.')) &&
    choose.mutate(
      {
        householdId: p.household.id,
        weekStart: p.weekStart,
        date: p.date,
        slot: p.slot,
        current,
        recipe,
        leftoverOf,
      },
      { onSuccess: () => go(back) },
    )

  // Nothing can be picked until we know what's in the slot now.
  const blocked = !week.isSuccess || choose.isPending || !!current?.locked
  const order = (e: Entry) => `${e.date}${SLOTS.indexOf(e.slot)}`
  const earlier = (week.data ?? []).filter(
    (e) => !e.leftover_of && order(e) < order({ date: p.date, slot: p.slot } as Entry),
  )
  const all = (recipes.data ?? []).filter((r) =>
    r.title.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const suits = all.filter((r) => r.meal_types.includes(p.slot))
  const others = all.filter((r) => !r.meal_types.includes(p.slot))
  const list = (rs: typeof all) => (
    <ul role="list" className={grid}>
      {rs.map((r) => (
        <li key={r.id} className="lg:border-b">
          <button className={row} disabled={blocked} onClick={() => pick(r)}>
            <span className="font-serif text-2xl leading-tight">
              {r.title}
              {r.is_favourite && <span className="text-highlight"> ★</span>}
            </span>
            {current?.recipe_id === r.id && (
              <span className="text-muted-foreground text-sm">In this slot now</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <Screen title={`${dayLabel(p.date)} ${p.slot}`} back={back} wide>
      {recipes.isError && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't load your recipes. Please reload the app.
        </p>
      )}
      {week.isError && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't load this week. Please reload the app.
        </p>
      )}
      {current?.locked && (
        <p role="status" className="text-sm">
          This meal is locked. Unlock it on the week first.
        </p>
      )}
      {choose.isError && (
        <p role="alert" className="text-destructive text-sm">
          {choose.error instanceof PlanError
            ? choose.error.message
            : "Couldn't save that. Check your connection and try again."}
        </p>
      )}

      {!!earlier.length && (
        <section className="flex flex-col gap-2">
          <h2 className={label}>Leftovers</h2>
          <ul role="list" className={grid}>
            {earlier.map((e) => (
              <li key={e.id} className="lg:border-b">
                <button
                  className={row}
                  disabled={blocked}
                  onClick={() => pick({ id: e.recipe_id, base_servings: e.servings }, e)}
                >
                  <span className="font-serif text-2xl leading-tight">{e.recipes.title}</span>
                  <span className="text-muted-foreground text-sm italic">
                    from {dayLabel(e.date)} {e.slot} · no extra shopping
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Input
        type="search"
        aria-label="Search recipes"
        placeholder="Search recipes"
        className="lg:max-w-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {recipes.isSuccess && !recipes.data.length && (
        <p className="text-muted-foreground font-serif text-xl italic">
          No recipes yet.{' '}
          <a href="#/recipes/new" className="underline">
            Add one
          </a>{' '}
          first.
        </p>
      )}
      {!!suits.length && (
        <section className="flex flex-col gap-2">
          <h2 className={label}>Suits {p.slot}</h2>
          {list(suits)}
        </section>
      )}
      {!!others.length && (
        <section className="flex flex-col gap-2">
          <h2 className={label}>Other recipes</h2>
          {list(others)}
        </section>
      )}
    </Screen>
  )
}
