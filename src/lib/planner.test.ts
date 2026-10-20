import {
  type Candidate,
  DEFAULT_SETTINGS,
  enabledSlots,
  isWeeknight,
  jaccard,
  planWeek,
  readSettings,
  recency,
  seededRandom,
  weekDates,
  weekStartFor,
} from './planner'

// Week of Mon 2026-10-26. Fri = 2026-10-30.
const MON = '2026-10-26'
const FRI = '2026-10-30'
const noJitter = { ...DEFAULT_SETTINGS, w_jitter: 0 }
const only = (over: Partial<typeof DEFAULT_SETTINGS>) => ({
  ...noJitter,
  w_recency: 0,
  w_fav: 0,
  w_overlap: 0,
  w_cuisine: 0,
  ...over,
})

const recipe = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  meal_types: ['dinner'],
  prep_minutes: 10,
  cook_minutes: 20,
  cuisine: null,
  is_favourite: false,
  ingredients: [],
  last_planned: null,
  ...over,
})
const ing = (id: string) => ({ id, name: id[0].toUpperCase() + id.slice(1) })

const pickFor = (recipes: Candidate[], settings = noJitter, date = FRI, extra = {}) =>
  planWeek({
    recipes,
    fixed: [],
    targets: [{ date, slot: 'dinner' }],
    settings,
    seed: 's',
    ...extra,
  })[0]

describe('candidates', () => {
  test('only recipes suited to the slot', () => {
    const p = pickFor([recipe('a', { meal_types: ['lunch'] }), recipe('b')])
    expect(p.recipe_id).toBe('b')
  })

  test('weeknights (Mon–Thu) skip recipes over the cook-time cap', () => {
    const slow = recipe('slow', { prep_minutes: 30, cook_minutes: 30, is_favourite: true })
    const quick = recipe('quick')
    expect(pickFor([slow, quick], noJitter, MON).recipe_id).toBe('quick')
    expect(pickFor([slow, quick], noJitter, FRI).recipe_id).toBe('slow')
  })

  test('the cap comes from settings and counts prep + cook (missing times = 0)', () => {
    const r = recipe('r', { prep_minutes: 40, cook_minutes: null })
    expect(pickFor([r], { ...noJitter, weeknight_cap: 30 }, MON).recipe_id).toBeNull()
    expect(pickFor([r], { ...noJitter, weeknight_cap: 40 }, MON).recipe_id).toBe('r')
  })

  test('a slot nothing fits stays empty', () => {
    expect(pickFor([recipe('a', { meal_types: ['breakfast'] })])).toEqual({
      date: FRI,
      slot: 'dinner',
      recipe_id: null,
      reason: '',
    })
  })
})

describe('used this week', () => {
  test('recipes already in the week are skipped', () => {
    const p = planWeek({
      recipes: [recipe('a', { is_favourite: true }), recipe('b')],
      fixed: [{ date: MON, slot: 'dinner', recipe_id: 'a' }],
      targets: [{ date: FRI, slot: 'dinner' }],
      settings: noJitter,
      seed: 's',
    })
    expect(p[0].recipe_id).toBe('b')
  })

  test('repeats are allowed when the library is too small, and say so', () => {
    const p = planWeek({
      recipes: [recipe('a')],
      fixed: [],
      targets: weekDates(MON).map((date) => ({ date, slot: 'dinner' as const })),
      settings: noJitter,
      seed: 's',
    })
    expect(p.every((x) => x.recipe_id === 'a')).toBe(true)
    expect(p[0].reason).not.toMatch(/Repeat/)
    expect(p[1].reason).toMatch(/^Repeat/)
  })

  test('picks within one run count as used', () => {
    const p = planWeek({
      recipes: [recipe('a'), recipe('b'), recipe('c')],
      fixed: [],
      targets: weekDates(MON)
        .slice(0, 3)
        .map((date) => ({ date, slot: 'dinner' as const })),
      settings: noJitter,
      seed: 's',
    })
    expect(new Set(p.map((x) => x.recipe_id)).size).toBe(3)
  })

  test('a reshuffled entry avoids its current recipe, unless nothing else fits', () => {
    const target = { date: FRI, slot: 'dinner' as const, avoid: 'a' }
    const run = (recipes: Candidate[]) =>
      planWeek({ recipes, fixed: [], targets: [target], settings: noJitter, seed: 's' })[0]
    expect(run([recipe('a', { is_favourite: true }), recipe('b')]).recipe_id).toBe('b')
    expect(run([recipe('a')]).recipe_id).toBe('a')
  })
})

describe('scoring', () => {
  test('recency: never planned = 1, capped at 60 days, scaled 0–1', () => {
    expect(recency(null, FRI)).toBe(1)
    expect(recency('2026-10-30', FRI)).toBe(0)
    expect(recency('2026-09-30', FRI)).toBe(0.5)
    expect(recency('2026-01-01', FRI)).toBe(1)
  })

  test('recency: longer since last planned wins', () => {
    const recent = recipe('recent', { last_planned: '2026-10-20' })
    const older = recipe('older', { last_planned: '2026-09-01' })
    expect(pickFor([recent, older], only({ w_recency: 1 })).recipe_id).toBe('older')
  })

  test('favourite adds w_fav', () => {
    const p = pickFor([recipe('a'), recipe('b', { is_favourite: true })], only({ w_fav: 1 }))
    expect(p.recipe_id).toBe('b')
    expect(p.reason).toMatch(/^Favourite/)
  })

  test('jaccard of ingredient sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3)
    expect(jaccard(new Set(), new Set(['a']))).toBe(0)
    expect(jaccard(new Set(['a']), new Set(['a']))).toBe(1)
  })

  test('ingredient overlap with the week wins, and the reason names it', () => {
    const p = planWeek({
      recipes: [
        recipe('fixed', { ingredients: [ing('spinach'), ing('feta')] }),
        recipe('other', { ingredients: [ing('beef')] }),
        recipe('sharer', { ingredients: [ing('spinach')] }),
      ],
      fixed: [{ date: '2026-10-27', slot: 'dinner', recipe_id: 'fixed' }],
      targets: [{ date: FRI, slot: 'dinner' }],
      settings: only({ w_overlap: 1 }),
      seed: 's',
    })
    expect(p[0].recipe_id).toBe('sharer')
    expect(p[0].reason).toMatch(/shares spinach with Tue$/)
  })

  test('same cuisine already in the week is penalised per repeat (case-insensitive)', () => {
    const p = planWeek({
      recipes: [
        recipe('t1', { cuisine: 'Thai' }),
        recipe('t2', { cuisine: 'thai ' }),
        recipe('i', { cuisine: 'Italian', last_planned: '2026-10-25' }),
      ],
      fixed: [{ date: MON, slot: 'dinner', recipe_id: 't1' }],
      targets: [{ date: FRI, slot: 'dinner' }],
      // Italian loses on recency (0.08) but Thai loses 1 for the repeat cuisine.
      settings: only({ w_recency: 1, w_cuisine: 1 }),
      seed: 's',
    })
    expect(p[0].recipe_id).toBe('i')
  })

  test('weights come from settings and are combined', () => {
    const fav = recipe('fav', { is_favourite: true, last_planned: '2026-10-29' })
    const fresh = recipe('fresh')
    // recency 1 vs favourite 1: with w_fav 2 the favourite wins, with w_fav 0.5 it loses.
    expect(pickFor([fav, fresh], only({ w_recency: 1, w_fav: 2 })).recipe_id).toBe('fav')
    expect(pickFor([fav, fresh], only({ w_recency: 1, w_fav: 0.5 })).recipe_id).toBe('fresh')
  })

  test('reason text for recency', () => {
    expect(pickFor([recipe('a')]).reason).toBe('Not had in a while')
    expect(pickFor([recipe('a', { last_planned: '2026-10-09' })]).reason).toBe('Not had in 3 weeks')
    expect(pickFor([recipe('a', { last_planned: '2026-10-25' })]).reason).toBe('Had 5 days ago')
  })
})

describe('seeded jitter', () => {
  const many = Array.from({ length: 12 }, (_, i) => recipe(`r${i}`))
  const run = (seed: string, recipes = many) =>
    planWeek({
      recipes,
      fixed: [],
      targets: weekDates(MON).map((date) => ({ date, slot: 'dinner' as const })),
      settings: DEFAULT_SETTINGS,
      seed,
    }).map((p) => p.recipe_id)

  test('same seed gives the same week', () => {
    expect(run('h:2026-10-26:0')).toEqual(run('h:2026-10-26:0'))
  })

  test('input order does not matter', () => {
    expect(run('h:2026-10-26:0', [...many].reverse())).toEqual(run('h:2026-10-26:0'))
  })

  test('a new reshuffle counter gives a different week', () => {
    expect(run('h:2026-10-26:1')).not.toEqual(run('h:2026-10-26:0'))
  })

  test('random numbers are repeatable and between 0 and 1', () => {
    const a = seededRandom('x')
    const b = seededRandom('x')
    const xs = Array.from({ length: 100 }, () => a())
    expect(xs).toEqual(Array.from({ length: 100 }, () => b()))
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
  })

  test('jitter is small: it never beats a real difference', () => {
    const fav = recipe('fav', { is_favourite: true })
    for (let i = 0; i < 20; i++)
      expect(pickFor([recipe('a'), fav], DEFAULT_SETTINGS, FRI, { seed: `${i}` }).recipe_id).toBe(
        'fav',
      )
  })
})

describe('settings and dates', () => {
  test('readSettings keeps valid numbers and falls back for the rest', () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(readSettings({ w_fav: 2, weeknight_cap: 30, w_recency: -1, w_overlap: 'x' })).toEqual({
      ...DEFAULT_SETTINGS,
      w_fav: 2,
      weeknight_cap: 30,
    })
  })

  test('enabledSlots follows slot_config in day order, dinner if empty', () => {
    expect(enabledSlots({ dinner: true, breakfast: true, lunch: false })).toEqual([
      'breakfast',
      'dinner',
    ])
    expect(enabledSlots({})).toEqual(['dinner'])
    expect(enabledSlots('junk')).toEqual(['dinner'])
  })

  test('weeknights are Monday to Thursday', () => {
    expect(weekDates(MON).map(isWeeknight)).toEqual([true, true, true, true, false, false, false])
  })

  test('weekStartFor finds the week start for any start day', () => {
    expect(weekStartFor('2026-10-30', 1)).toBe(MON)
    expect(weekStartFor(MON, 1)).toBe(MON)
    expect(weekStartFor('2026-10-30', 0)).toBe('2026-10-25')
    expect(weekStartFor('2026-10-25', 1)).toBe('2026-10-19')
  })
})
