import { planDeletion, type Member } from './plan'

const m = (household_id: string, user_id: string, role: string, created_at: string): Member => ({
  household_id,
  user_id,
  role,
  created_at,
})

test('a household with nobody else in it is removed', () => {
  expect(planDeletion('me', [m('h1', 'me', 'owner', '2026-01-01')])).toEqual({
    deleteHouseholds: ['h1'],
    newOwners: [],
  })
})

test('the longest-standing other member takes over when the only owner leaves', () => {
  const plan = planDeletion('me', [
    m('h1', 'me', 'owner', '2026-01-01'),
    m('h1', 'late', 'member', '2026-03-01'),
    m('h1', 'early', 'member', '2026-02-01'),
  ])
  expect(plan.deleteHouseholds).toEqual([])
  expect(plan.newOwners.map((o) => o.user_id)).toEqual(['early'])
})

test('nothing changes for others when a member leaves or another owner remains', () => {
  expect(
    planDeletion('me', [
      m('h1', 'me', 'member', '2026-01-01'),
      m('h1', 'boss', 'owner', '2026-01-01'),
      m('h2', 'me', 'owner', '2026-01-01'),
      m('h2', 'co', 'owner', '2026-02-01'),
    ]),
  ).toEqual({ deleteHouseholds: [], newOwners: [] })
})
