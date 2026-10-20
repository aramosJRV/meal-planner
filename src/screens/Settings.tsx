import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { enabledSlots, readSettings, SLOTS } from '@/lib/planner'
import { supabase } from '@/lib/supabase'
import type { Household } from './planData'
import Screen from './Screen'

type Props = { household: Household; userId: string }
const heading = 'text-highlight text-xs font-bold tracking-[0.16em] uppercase'

export default function Settings({ household, userId }: Props) {
  const queryClient = useQueryClient()
  const [slots, setSlots] = useState<string[]>(enabledSlots(household.slot_config))
  const [cap, setCap] = useState(String(readSettings(household.planner_settings).weeknight_cap))
  const role = useQuery({
    queryKey: ['role', household.id, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('household_members')
        .select('role')
        .eq('household_id', household.id)
        .eq('user_id', userId)
        .single()
      if (error) throw error
      return data.role
    },
  })

  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
    onSuccess: () => queryClient.clear(),
  })

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('household_invites')
        .insert({ household_id: household.id })
        .select('code, expires_at')
        .single()
      if (error) throw error
      return data
    },
  })

  const capMinutes = Number(cap)
  const capValid =
    cap.trim() !== '' && Number.isInteger(capMinutes) && capMinutes >= 0 && capMinutes <= 1000
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('households')
        .update({
          slot_config: Object.fromEntries(SLOTS.map((s) => [s, slots.includes(s)])),
          planner_settings: {
            ...(household.planner_settings as object),
            weeknight_cap: capMinutes,
          },
        })
        .eq('id', household.id)
        .select('id')
        .single()
      if (error) throw error
    },
    onError: (e) => console.error('save settings', e),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['households'] }),
  })
  const owner = role.data === 'owner'

  return (
    <Screen title={household.name} nav="settings">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <fieldset className="flex flex-col gap-2" disabled={!owner}>
          <legend className={`${heading} mb-2`}>Meals to plan</legend>
          {SLOTS.map((s) => (
            <label key={s} className="flex min-h-11 items-center gap-3 border-b capitalize">
              <input
                type="checkbox"
                checked={slots.includes(s)}
                onChange={(e) =>
                  setSlots((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))
                }
              />
              {s}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cap">Weeknight time limit (minutes)</Label>
          <Input
            id="cap"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            className="w-28"
            disabled={!owner}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
          <p className="text-muted-foreground text-sm">
            Monday to Thursday suggestions stay within this much prep and cooking time.
          </p>
        </div>
        {owner ? (
          <Button type="submit" disabled={!slots.length || !capValid || save.isPending}>
            Save settings
          </Button>
        ) : (
          role.isSuccess && (
            <p className="text-muted-foreground text-sm">
              Only the household owner can change these.
            </p>
          )
        )}
        {!slots.length && <p className="text-destructive text-sm">Choose at least one meal.</p>}
        {save.isSuccess && (
          <p role="status" className="text-sm">
            Saved.
          </p>
        )}
        {save.isError && (
          <p role="alert" className="text-destructive text-sm">
            Couldn't save your settings. Check your connection and try again.
          </p>
        )}
      </form>

      {role.isError && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't load your household details. Please reload the app.
        </p>
      )}

      {owner && (
        <section className="flex flex-col gap-3">
          <h2 className={heading}>Household</h2>
          <Button variant="outline" onClick={() => invite.mutate()} disabled={invite.isPending}>
            Invite someone
          </Button>
          {invite.data && (
            <p>
              Share this code: <strong data-testid="invite-code">{invite.data.code}</strong>
              <br />
              <span className="text-muted-foreground text-sm">
                It works once and expires on{' '}
                {new Date(invite.data.expires_at).toLocaleDateString('en-AU', {
                  day: 'numeric',
                  month: 'long',
                })}
                .
              </span>
            </p>
          )}
          {invite.isError && (
            <p role="alert" className="text-destructive text-sm">
              Couldn't create an invite. Please try again.
            </p>
          )}
        </section>
      )}

      <Button variant="ghost" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
        Sign out
      </Button>
      {signOut.isError && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't sign out. Check your connection and try again.
        </p>
      )}
    </Screen>
  )
}
