import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { SLOTS, type Slot } from '@/lib/planner'
import { go, useRecipes } from './recipeData'
import { dayLabel, type Entry, type Household, setSlot, usePlanChange, useWeek } from './planData'
import Screen from './Screen'

const label = 'text-highlight text-xs font-bold tracking-[0.16em] uppercase'
const row = 'flex w-full flex-col py-3 text-left hover:underline disabled:opacity-50'

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
  const pick = (recipe: { id: string; base_servings: number }, leftoverOf?: Entry) =>
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
    <ul role="list" className="border-foreground flex flex-col divide-y border-t-[1.5px]">
      {rs.map((r) => (
        <li key={r.id}>
          <button className={row} disabled={choose.isPending} onClick={() => pick(r)}>
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
    <Screen title={`${dayLabel(p.date)} ${p.slot}`} back={back}>
      {(recipes.isError || week.isError) && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't load your recipes. Please reload the app.
        </p>
      )}
      {choose.isError && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't save that. Check your connection and try again.
        </p>
      )}

      {!!earlier.length && (
        <section className="flex flex-col gap-2">
          <h2 className={label}>Leftovers</h2>
          <ul role="list" className="border-foreground flex flex-col divide-y border-t-[1.5px]">
            {earlier.map((e) => (
              <li key={e.id}>
                <button
                  className={row}
                  disabled={choose.isPending}
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
