import { onlineManager, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { weekStartFor } from '@/lib/planner'
import { supabase } from '@/lib/supabase'
import { formatQuantity, unitLabel } from '@/lib/units'
import {
  type Add,
  GroceryError,
  type Item,
  type List,
  listKey,
  type Remove,
  type Rename,
  syncList,
  type Tick,
  useGroceryList,
} from './groceryData'
import { type Household, local, today } from './planData'
import Screen from './Screen'

const label = 'text-xs font-semibold tracking-[0.14em] uppercase'

// Shop order, roughly how an Australian supermarket is laid out.
const AISLES: [string, string][] = [
  ['produce', 'Fruit & veg'],
  ['bakery', 'Bakery'],
  ['meat_seafood', 'Meat & seafood'],
  ['dairy_eggs', 'Dairy & eggs'],
  ['pantry', 'Pantry'],
  ['spices', 'Herbs & spices'],
  ['frozen', 'Frozen'],
  ['drinks', 'Drinks'],
  ['other', 'Other'],
]

// Coles has no API for outside apps (DESIGN.md §7): we only link to its own product search.
const colesSearch = (name: string) =>
  `https://www.coles.com.au/search/products?q=${encodeURIComponent(name)}`

const changes = (n: number) => (n === 1 ? '1 change' : `${n} changes`)

const amounts = (item: Item) =>
  item.quantities
    .filter((q) => typeof q?.qty === 'number' && typeof q.unit === 'string')
    .map((q) => [formatQuantity(q.qty, q.unit), unitLabel(q.unit, q.qty)].filter(Boolean).join(' '))
    .join(' + ')

export default function GroceryList({
  household,
  weekStart: requested,
}: {
  household: Household
  weekStart?: string
}) {
  const weekStart = weekStartFor(requested ?? today(), household.week_start_day)
  const key = listKey(household.id, weekStart)
  const list = useGroceryList(household.id, weekStart)
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  // The manual item being renamed, and its new name.
  const [editing, setEditing] = useState<{ id: string; to: string } | null>(null)
  // Shop at Coles: the unticked items when it started, and which one is showing.
  const [shop, setShop] = useState<{ items: Item[]; at: number } | null>(null)
  const listId = list.data?.id

  const refresh = useMutation({
    mutationFn: () => syncList(household.id, weekStart),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
  // mutationFn and callbacks come from registerGroceryMutations (main.tsx).
  const tick = useMutation<void, Error, Tick>({ mutationKey: ['grocery', 'tick'] })
  const add = useMutation<void, Error, Add>({ mutationKey: ['grocery', 'add'] })
  const rename = useMutation<void, Error, Rename>({ mutationKey: ['grocery', 'rename'] })
  const remove = useMutation<void, Error, Remove>({ mutationKey: ['grocery', 'remove'] })
  const online = useSyncExternalStore(onlineManager.subscribe.bind(onlineManager), () =>
    onlineManager.isOnline(),
  )
  // Every grocery change, including ones resumed after a restart that no button is watching.
  const waiting = useMutationState({ filters: { mutationKey: ['grocery'], status: 'pending' } })
  const failed = useMutationState({
    filters: { mutationKey: ['grocery'], status: 'error' },
    select: (m) => {
      const v = m.state.variables as Partial<Tick & Add>
      return v.name ?? v.item?.display_name ?? 'an item'
    },
  })

  // Catch up on plan changes made elsewhere, or a sync that didn't finish.
  useEffect(() => {
    if (onlineManager.isOnline()) refresh.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening of this week's list
  }, [])

  // A tick on another phone shows here (DESIGN.md §8).
  useEffect(() => {
    if (!listId) return
    const refetch = () =>
      queryClient.invalidateQueries({ queryKey: listKey(household.id, weekStart) })
    const channel = supabase
      .channel(`grocery:${listId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'grocery_items', filter: `list_id=eq.${listId}` },
        refetch,
      )
      // Deletes carry only the id, so they can't be filtered by list: refetch only for our items.
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'grocery_items' },
        (p) => {
          const list = queryClient.getQueryData<List | null>(listKey(household.id, weekStart))
          if (list?.grocery_items.some((i) => i.id === p.old.id)) refetch()
        },
      )
      .subscribe()
    return () => void supabase.removeChannel(channel)
  }, [listId, household.id, weekStart, queryClient])

  const items = list.data?.grocery_items ?? []
  const byAisle = AISLES.map(([aisle, title]) => ({
    aisle,
    title,
    items: items
      .filter((i) => i.aisle_category === aisle)
      .sort(
        (a, b) =>
          Number(a.checked) - Number(b.checked) || a.display_name.localeCompare(b.display_name),
      ),
  })).filter((g) => g.items.length)

  const toBuy = byAisle.flatMap((g) => g.items.filter((i) => !i.checked))
  const shopping = shop && shop.items[shop.at]
  const nextItem = (tickIt: boolean) => {
    if (!shop || !shopping) return
    if (tickIt) tick.mutate({ key, id: shopping.id, name: shopping.display_name, checked: true })
    setShop(shop.at + 1 < shop.items.length ? { ...shop, at: shop.at + 1 } : null)
  }

  const week = local(weekStart).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  return (
    <Screen title="Shopping list" nav="list" wide>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">For the week of {week}</p>
        <Button
          className="lg:self-start lg:px-10"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? 'Refreshing…' : 'Refresh list'}
        </Button>
        {!shop && toBuy.length > 0 && (
          <Button
            variant="outline"
            className="lg:self-start lg:px-10"
            onClick={() => setShop({ items: toBuy, at: 0 })}
          >
            Shop at Coles
          </Button>
        )}
        {refresh.isError && (
          <p role="alert" className="text-destructive text-sm">
            {refresh.error instanceof GroceryError
              ? refresh.error.message
              : "Couldn't refresh the list. Please try again."}
          </p>
        )}
      </div>

      {shop && shopping && (
        <section
          aria-label="Shop at Coles"
          className="border-foreground flex flex-col gap-3 border-[1.5px] p-4 lg:max-w-md"
        >
          <p className={label}>
            Item {shop.at + 1} of {shop.items.length}
          </p>
          <p className="flex flex-col">
            <span className="font-serif text-2xl">{shopping.display_name}</span>
            {shopping.quantities.length > 0 && (
              <span className="text-muted-foreground text-sm">{amounts(shopping)}</span>
            )}
          </p>
          <a
            href={colesSearch(shopping.display_name)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Search Coles for {shopping.display_name}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => nextItem(true)}>
              Got it, tick and next
            </Button>
            <Button variant="outline" onClick={() => nextItem(false)}>
              Skip
            </Button>
            <Button variant="ghost" className="px-2" onClick={() => setShop(null)}>
              Stop
            </Button>
          </div>
        </section>
      )}

      {(!online || waiting.length > 0) && (
        <p role="status" className="bg-muted px-3 py-2 text-sm">
          {online
            ? `Sending ${changes(waiting.length)}…`
            : `Offline. ${waiting.length ? changes(waiting.length) : 'Your changes'} will be sent when you're back online.`}
        </p>
      )}
      {failed.length > 0 && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't save the change to {[...new Set(failed)].join(', ')}. It may have changed on the
          list. Please check and try again.
        </p>
      )}
      {list.isError && !list.data && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't load the list. Check your connection and try again.
        </p>
      )}
      {list.fetchStatus === 'paused' && !list.data && (
        <p className="text-muted-foreground text-sm">
          No signal. The list will load when you're back online.
        </p>
      )}
      {list.isSuccess && !items.length && (
        <p className="text-muted-foreground font-serif text-xl italic">
          {listId
            ? 'Nothing on the list yet. Plan some meals or add an item below.'
            : 'Nothing on the list yet. Plan some meals, then tap Refresh list.'}
        </p>
      )}

      {/* One column on phone; aisles side by side on wide screens. */}
      {!!byAisle.length && (
        <div className="flex flex-col gap-6 lg:block lg:columns-2 lg:gap-12 xl:columns-3">
          {byAisle.map((g) => (
            <section
              key={g.aisle}
              aria-labelledby={`aisle-${g.aisle}`}
              className="flex flex-col lg:mb-8 lg:break-inside-avoid"
            >
              <h2
                id={`aisle-${g.aisle}`}
                className={`${label} border-foreground border-b-[1.5px] pb-1`}
              >
                {g.title}
              </h2>
              <ul role="list" className="flex flex-col divide-y">
                {g.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    {editing?.id === item.id ? (
                      <form
                        className="flex min-h-11 flex-1 items-center gap-2 py-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          const to = editing.to.trim()
                          if (to && to !== item.display_name)
                            rename.mutate({
                              key,
                              id: item.id,
                              name: item.display_name,
                              to,
                              household_id: household.id,
                            })
                          setEditing(null)
                        }}
                      >
                        <Input
                          aria-label={`New name for ${item.display_name}`}
                          maxLength={100}
                          autoFocus
                          value={editing.to}
                          onChange={(e) => setEditing({ id: item.id, to: e.target.value })}
                          onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                        />
                        <Button type="submit">Save</Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <label
                        className={`flex min-h-11 flex-1 items-center gap-3 py-2 ${item.checked || item.stale ? 'text-muted-foreground' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="size-5"
                          checked={item.checked}
                          onChange={(e) =>
                            tick.mutate({
                              key,
                              id: item.id,
                              name: item.display_name,
                              checked: e.target.checked,
                            })
                          }
                        />
                        <span className="flex flex-1 flex-col">
                          <span className={`text-lg ${item.checked ? 'line-through' : ''}`}>
                            {item.display_name}
                          </span>
                          {(item.quantities.length > 0 || item.stale) && (
                            <span className="text-muted-foreground text-sm">
                              {[amounts(item), item.stale && 'No longer in the plan']
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </span>
                      </label>
                    )}
                    {!item.checked && editing?.id !== item.id && (
                      <a
                        href={colesSearch(item.display_name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Search Coles for ${item.display_name} (opens in a new tab)`}
                        className={buttonVariants({ variant: 'ghost', className: 'px-2' })}
                      >
                        Coles
                      </a>
                    )}
                    {item.source === 'manual' && editing?.id !== item.id && (
                      <>
                        <Button
                          variant="ghost"
                          className="px-2"
                          aria-label={`Rename ${item.display_name}`}
                          onClick={() => setEditing({ id: item.id, to: item.display_name })}
                        >
                          Rename
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2"
                          aria-label={`Remove ${item.display_name}`}
                          onClick={() =>
                            remove.mutate({ key, id: item.id, name: item.display_name })
                          }
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {listId && (
        <form
          className="flex gap-2 lg:max-w-md"
          onSubmit={(e) => {
            e.preventDefault()
            const display_name = name.trim()
            if (!display_name) return
            add.mutate({
              key,
              item: {
                id: crypto.randomUUID(),
                list_id: listId,
                household_id: household.id,
                display_name,
                aisle_category: 'other',
                source: 'manual',
                quantities: [],
                checked: false,
                stale: false,
              },
            })
            setName('')
          }}
        >
          <Input
            aria-label="Add an item"
            placeholder="Add an item"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="outline">
            Add
          </Button>
        </form>
      )}
    </Screen>
  )
}
