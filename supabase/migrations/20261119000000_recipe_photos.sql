-- Recipe photos: members may set or clear recipes.image_path (the file itself is in the private
-- recipe-media bucket). A recipe may only point into its own household's recipes/ folder.
grant update (image_path) on public.recipes to authenticated;

alter table public.recipes add constraint recipes_image_path_own_folder check (
  image_path is null
  or (image_path like household_id::text || '/recipes/%' and image_path not like '%..%')
);
