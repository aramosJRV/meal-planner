import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import Screen from './Screen'

const joinErrors: Record<string, string> = {
  not_found: "We couldn't find that code. Check it and try again.",
  expired: 'That code has expired. Ask for a new one.',
  used: 'That code has already been used. Ask for a new one.',
  too_many_attempts: 'Too many attempts. Please try again in an hour.',
}

export default function Onboarding() {
  const queryClient = useQueryClient()
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['households'] })

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.rpc('create_household', { p_name: name })
      if (error) throw error
    },
    onSuccess,
  })

  const join = useMutation({
    mutationFn: async (code: string) => {
      const { error } = await supabase.functions.invoke('accept-invite', { body: { code } })
      if (error instanceof FunctionsHttpError) {
        const { error: reason } = await error.context.json()
        throw new Error(joinErrors[reason] ?? 'Something went wrong. Please try again.')
      }
      if (error) throw new Error('Something went wrong. Please try again.')
    },
    onSuccess,
  })

  return (
    <Screen title="Set up your household">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate(new FormData(e.currentTarget).get('name') as string)
        }}
      >
        <Label htmlFor="name">Household name</Label>
        <Input id="name" name="name" placeholder="e.g. The Smiths" maxLength={80} required />
        <Button type="submit" disabled={create.isPending}>
          Create household
        </Button>
        {create.isError && (
          <p role="alert" className="text-destructive text-sm">
            Couldn't create your household. Please try again.
          </p>
        )}
      </form>

      <p className="text-muted-foreground text-center text-sm">or</p>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          join.mutate(new FormData(e.currentTarget).get('code') as string)
        }}
      >
        <Label htmlFor="code">Invite code</Label>
        <Input id="code" name="code" autoCapitalize="characters" autoComplete="off" required />
        <Button type="submit" variant="outline" disabled={join.isPending}>
          Join household
        </Button>
        {join.isError && (
          <p role="alert" className="text-destructive text-sm">
            {join.error.message}
          </p>
        )}
      </form>
    </Screen>
  )
}
