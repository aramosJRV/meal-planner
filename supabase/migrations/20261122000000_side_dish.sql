-- Recipes can be tagged as a side dish. 'side' is not a planner slot, so Suggest week never picks
-- a side-only recipe; it can still be chosen by hand.
alter table public.recipes drop constraint recipes_meal_types_check;
alter table public.recipes add constraint recipes_meal_types_check
  check (meal_types <@ array['breakfast', 'lunch', 'dinner', 'snack', 'side']);
