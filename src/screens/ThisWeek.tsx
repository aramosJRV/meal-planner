import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { enabledSlots, readSettings, weekDates, weekStartFor } from '@/lib/planner'
import {
  type Entry,
  generate,
  type Household,
  PlanError,
  removeEntry,
  dayLabel,
  local,
  today,
  updateEntry,
  usePlanChange,
  useWeek,
} from './planData'
import { syncSoon } from './groceryData'
import Screen from './Screen'

const label = 'text-xs font-semibold tracking-[0.14em] uppercase'
const action = `${label} text-muted-foreground hover:text-foreground flex min-h-11 items-center disabled:opacity-40`
const shortDate = (date: string) =>
  local(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
const shiftWeek = (weekStart: string, weeks: number) =>
  new Date(Date.parse(`${weekStart}T00:00:00Z`) + weeks * 7 * 86_400_000).toISOString().slice(0, 10)

export default function ThisWeek({
  household,
  weekStart: requested,
}: {
  household: Household
  weekStart?: string
}) {
  const current = weekStartFor(today(), household.week_start_day)
  const weekStart = requested ? weekStartFor(requested, household.week_start_day) : current
  const dates = weekDates(weekStart)
  const slots = enabledSlots(household.slot_config)
  const week = useWeek(household.id, weekStart)
  const queryClient = useQueryClient()

  const suggest = useMutation({
    mutationFn: () =>
      generate({ household_id: household.id, week_start: weekStart, scope: 'week' }),
    onSettled: () => {
      syncSoon(queryClient, household.id, weekStart)
      return queryClient.invalidateQueries({ queryKey: ['week', household.id, weekStart] })
    },
  })

  const at = new Map((week.data ?? []).map((e) => [`${e.date}|${e.slot}`, e]))
  const title = weekStart === current ? 'This week' : `Week of ${shortDate(weekStart)}`

  return (
    <Screen title={title} nav="week" wide>
      <div className="flex items-center justify-between gap-2">
        <a
          href={`#/week/${shiftWeek(weekStart, -1)}`}
          className={action}
          aria-label="Previous week"
        >
          ← Prev
        </a>
        <p className="text-muted-foreground text-sm">
          {shortDate(dates[0])} – {shortDate(dates[6])}
        </p>
        <a href={`#/week/${shiftWeek(weekStart, 1)}`} className={action} aria-label="Next week">
          Next →
        </a>
      </div>
      <a href={`#/list/${weekStart}`} className={action}>
        Shopping list for this week →
      </a>

      <div className="flex flex-col gap-2">
        <Button onClick={() => suggest.mutate()} disabled={suggest.isPending || week.isPending}>
          {suggest.isPending ? 'Suggesting…' : 'Suggest week'}
        </Button>
        <p className="text-muted-foreground text-sm">
          Fills empty slots and reshuffles anything not locked.
        </p>
        {suggest.isError && (
          <p role="alert" className="text-destructive text-sm">
            {suggest.error.message}
          </p>
        )}
        {suggest.data && suggest.data.unfilled > 0 && (
          <p role="status" className="text-sm">
            {suggest.data.unfilled === 1
              ? "One slot couldn't"
              : `${suggest.data.unfilled} slots couldn't`}{' '}
            be filled. Add more recipes that suit those meals (weeknights need{' '}
            {readSettings(household.planner_settings).weeknight_cap} minutes or less, unless you
            change it in Settings).
          </p>
        )}
      </div>

      {week.isError && !week.data && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't load this week. Please reload the app.
        </p>
      )}

      {/* Day list on phone; seven columns on wide screens. */}
      <ol role="list" className="flex flex-col gap-8 lg:grid lg:grid-cols-7 lg:gap-4">
        {dates.map((date) => (
          <li key={date} className="flex flex-col" data-testid={`day-${date}`}>
            <h2
              className={`border-foreground flex items-baseline justify-between border-b-[1.5px] pb-1 ${date === today() ? 'text-highlight' : ''}`}
            >
              <span className="font-serif text-3xl lg:text-2xl">{dayLabel(date)}</span>
              <span className={label}>{date === today() ? 'Today' : shortDate(date)}</span>
            </h2>
            <ul role="list" className="flex flex-col divide-y">
              {slots.map((slot) => (
                <SlotRow
                  key={slot}
                  household={household}
                  weekStart={weekStart}
                  date={date}
                  slot={slot}
                  entry={at.get(`${date}|${slot}`)}
                  source={(id) => week.data?.find((e) => e.id === id)}
                  hasLeftovers={(id) => !!week.data?.some((e) => e.leftover_of === id)}
                  loading={!week.isSuccess}
                />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Screen>
  )
}

function SlotRow(p: {
  household: Household
  weekStart: string
  date: string
  slot: Entry['slot']
  entry?: Entry
  source: (id: string) => Entry | undefined
  hasLeftovers: (id: string) => boolean
  loading: boolean
}) {
  const { entry } = p
  const change = usePlanChange(p.household.id, p.weekStart, (f: () => Promise<unknown>) => f())
  const choose = `#/week/${p.weekStart}/${p.date}/${p.slot}`
  const from = entry?.leftover_of ? p.source(entry.leftover_of) : undefined

  return (
    <li className="flex flex-col gap-1 py-3" data-testid={`slot-${p.date}-${p.slot}`}>
      <span className={`${label} ${entry?.locked ? 'text-highlight' : 'text-muted-foreground'}`}>
        {p.slot}
        {entry?.locked && ' · Locked'}
      </span>

      {!entry ? (
        !p.loading && (
          <>
            <span className="text-muted-foreground font-serif text-xl italic">Nothing yet</span>
            <a href={choose} className={action}>
              Choose a meal
            </a>
          </>
        )
      ) : (
        <>
          <a
            href={`#/recipes/${entry.recipe_id}`}
            className="font-serif text-2xl leading-tight hover:underline"
          >
            {entry.recipes.title}
          </a>
          {from ? (
            <span className="text-muted-foreground text-sm italic">
              Leftovers from {dayLabel(from.date)} {from.slot}
            </span>
          ) : (
            entry.reason && <span className="text-muted-foreground text-sm">{entry.reason}</span>
          )}
          {!entry.leftover_of && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Fewer servings"
                disabled={entry.servings <= 1 || change.isPending}
                onClick={() =>
                  change.mutate(() => updateEntry(entry.id, { servings: entry.servings - 1 }))
                }
              >
                −
              </Button>
              <span className="w-16 text-center text-sm" aria-live="polite">
                Serves {entry.servings}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="More servings"
                disabled={entry.servings >= 100 || change.isPending}
                onClick={() =>
                  change.mutate(() => updateEntry(entry.id, { servings: entry.servings + 1 }))
                }
              >
                +
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4">
            {!entry.leftover_of && (
              <>
                <button
                  className={`${action} ${entry.locked ? 'text-highlight' : ''}`}
                  aria-pressed={entry.locked}
                  disabled={change.isPending}
                  onClick={() =>
                    change.mutate(() => updateEntry(entry.id, { locked: !entry.locked }))
                  }
                >
                  {entry.locked ? 'Unlock' : 'Lock'}
                </button>
                <button
                  className={action}
                  disabled={entry.locked || change.isPending}
                  onClick={() =>
                    change.mutate(async () => {
                      const { changed } = await generate({
                        household_id: p.household.id,
                        week_start: p.weekStart,
                        scope: 'entry',
                        entry_id: entry.id,
                      })
                      if (!changed)
                        throw new PlanError(
                          'No other recipes suit this meal. Add more, or choose one yourself.',
                        )
                    })
                  }
                >
                  Reshuffle
                </button>
              </>
            )}
            {!entry.locked && (
              <a href={choose} className={action}>
                Swap
              </a>
            )}
            {!entry.locked && (
              <button
                className={action}
                disabled={change.isPending}
                onClick={() =>
                  (!p.hasLeftovers(entry.id) ||
                    window.confirm('This also removes its leftovers later in the week.')) &&
                  change.mutate(() => removeEntry(entry.id))
                }
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}
      {change.isError && (
        <p role="alert" className="text-destructive text-sm">
          {change.error instanceof PlanError
            ? change.error.message
            : "Couldn't change this meal. Check your connection and try again."}
        </p>
      )}
    </li>
  )
}
