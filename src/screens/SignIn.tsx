import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import Screen from './Screen'

export default function SignIn() {
  const send = useMutation({
    mutationFn: async (email: string) => {
      // TODO(v2): native deep link for the redirect; on iOS/Android origin is capacitor://localhost.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
    },
  })

  if (send.isSuccess)
    return (
      <Screen title="Check your email">
        <p className="text-muted-foreground">
          We've sent you a sign-in link. Open it on this device to continue.
        </p>
        <Button variant="outline" onClick={() => send.reset()}>
          Use a different email
        </Button>
      </Screen>
    )

  return (
    <Screen title="Meal Planner">
      <p className="text-muted-foreground">Plan your week, shop once. Sign in to get started.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          send.mutate(new FormData(e.currentTarget).get('email') as string)
        }}
      >
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        <Button type="submit" disabled={send.isPending}>
          Email me a sign-in link
        </Button>
        {send.isError && (
          <p role="alert" className="text-destructive text-sm">
            Couldn't send the link. Please check your email address and try again.
          </p>
        )}
      </form>
    </Screen>
  )
}
