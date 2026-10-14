// Pure invite validation, shared by the Edge Function and its Vitest tests.
export type Invite = { expires_at: string; used_at: string | null }

export type InviteProblem = 'not_found' | 'expired' | 'used'

// Failed (not_found) guesses allowed per user per hour, so codes can't be brute-forced.
export const MAX_FAILED_GUESSES = 5
export const isGuessLimited = (failedLastHour: number) => failedLastHour >= MAX_FAILED_GUESSES

export function checkInvite(invite: Invite | null, now = new Date()): InviteProblem | null {
  if (!invite) return 'not_found'
  if (invite.used_at) return 'used'
  if (new Date(invite.expires_at) <= now) return 'expired'
  return null
}

// Codes are shown in upper case; accept whatever the user typed.
export const normaliseCode = (code: unknown) =>
  typeof code === 'string' ? code.replace(/[\s-]/g, '').toUpperCase() : ''
