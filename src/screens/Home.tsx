import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import Screen from './Screen'

type Props = { household: { id: string; name: string }; userId: string }

// shortcut: placeholder home until the This Week screen lands in M4.
export default function Home({ household, userId }: Props) {
  const queryClient = useQueryClient()
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

  return (
    <Screen title={household.name}>
      <p className="text-muted-foreground">Your week's meals will appear here.</p>

      {role.data === 'owner' && (
        <section className="flex flex-col gap-3">
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

      <Button
        variant="ghost"
        onClick={async () => {
          await supabase.auth.signOut()
          queryClient.clear()
        }}
      >
        Sign out
      </Button>
    </Screen>
  )
}
