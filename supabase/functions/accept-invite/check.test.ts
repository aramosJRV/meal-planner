import { checkInvite, isGuessLimited, normaliseCode } from './check'

const now = new Date('2026-10-14T00:00:00Z')
const future = '2026-10-20T00:00:00Z'

test('missing invite is not found', () => {
  expect(checkInvite(null, now)).toBe('not_found')
})

test('valid invite passes', () => {
  expect(checkInvite({ expires_at: future, used_at: null }, now)).toBeNull()
})

test('expired invite is rejected, including the exact expiry instant', () => {
  expect(checkInvite({ expires_at: '2026-10-13T00:00:00Z', used_at: null }, now)).toBe('expired')
  expect(checkInvite({ expires_at: now.toISOString(), used_at: null }, now)).toBe('expired')
})

test('used invite is rejected even if not expired', () => {
  expect(checkInvite({ expires_at: future, used_at: '2026-10-13T00:00:00Z' }, now)).toBe('used')
})

test('codes are normalised', () => {
  expect(normaliseCode(' ab12-cd34 ')).toBe('AB12CD34')
  expect(normaliseCode(42)).toBe('')
})

test('guessing is limited after 5 failures', () => {
  expect(isGuessLimited(4)).toBe(false)
  expect(isGuessLimited(5)).toBe(true)
})
