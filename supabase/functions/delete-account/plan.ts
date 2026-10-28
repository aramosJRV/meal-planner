export type Member = { household_id: string; user_id: string; role: string; created_at: string }

// What happens to each of the leaver's households: removed if nobody else is in it, otherwise
// the longest-standing other member becomes owner when the leaver was the only one.
// `members` holds every membership row of every household the leaver belongs to.
export function planDeletion(userId: string, members: Member[]) {
  const deleteHouseholds: string[] = []
  const newOwners: Member[] = []
  for (const hid of new Set(members.map((m) => m.household_id))) {
    const rows = members.filter((m) => m.household_id === hid)
    const others = rows
      .filter((m) => m.user_id !== userId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    if (!others.length) deleteHouseholds.push(hid)
    else if (!others.some((m) => m.role === 'owner') && rows.some((m) => m.role === 'owner'))
      newOwners.push(others[0])
  }
  return { deleteHouseholds, newOwners }
}
