-- =============================================================================
-- 20260818110000_storage_branding.sql
-- Storage bucket for hospital branding (logos).
--
-- Layout: one folder per tenant, named with the hospital_id.
--     branding/<hospital_id>/logo-<timestamp>.<ext>
--
-- The first path segment IS the tenant boundary, so every policy below checks
-- it against the JWT claim -- the same rule as CLAUDE.md 3.1, applied to
-- object keys instead of rows.
--
-- Public read is deliberate. A logo is printed on every invoice and receipt,
-- rendered by a thermal printer driver and by any browser without a session.
-- Signed URLs would expire mid print job. Nothing else goes in this bucket.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  2097152,                                  -- 2 MB. A logo is not a photograph.
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Policies on storage.objects.
--
-- storage.objects is owned by supabase_storage_admin, not by postgres. On some
-- projects the migration role may create policies on it, on others it may not.
-- A branding bucket is not worth a failed migration, so a privilege error
-- degrades to a loud notice with the manual steps rather than aborting.
-- -----------------------------------------------------------------------------
do $$
begin
  -- Idempotent: drop before create, so a partial earlier run cannot make this
  -- block abort halfway. An exception here rolls back the whole block.
  drop policy if exists branding_read_public   on storage.objects;
  drop policy if exists branding_insert_admin  on storage.objects;
  drop policy if exists branding_update_admin  on storage.objects;
  drop policy if exists branding_delete_admin  on storage.objects;

  -- Anyone may read. See the note above: invoices print without a session.
  execute $p$
    create policy branding_read_public on storage.objects
      for select to public
      using (bucket_id = 'branding')
  $p$;

  -- Writes are admin-only, and only into the caller's own hospital folder.
  execute $p$
    create policy branding_insert_admin on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'branding'
        and public.is_hospital_admin()
        and (storage.foldername(name))[1] = public.app_hospital_id()::text
      )
  $p$;

  execute $p$
    create policy branding_update_admin on storage.objects
      for update to authenticated
      using (
        bucket_id = 'branding'
        and public.is_hospital_admin()
        and (storage.foldername(name))[1] = public.app_hospital_id()::text
      )
      with check (
        bucket_id = 'branding'
        and (storage.foldername(name))[1] = public.app_hospital_id()::text
      )
  $p$;

  -- The one deliberate delete in this codebase. It removes a superseded logo
  -- FILE, never a row: CLAUDE.md 3.5 is about records, and leaving every
  -- replaced logo behind would grow the bucket forever.
  execute $p$
    create policy branding_delete_admin on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'branding'
        and public.is_hospital_admin()
        and (storage.foldername(name))[1] = public.app_hospital_id()::text
      )
  $p$;

exception
  when insufficient_privilege then
    raise warning using message =
      'storage: could not create policies on storage.objects. Create them by hand: '
      'Dashboard -> Storage -> branding -> Policies. Read: public. '
      'Insert/update/delete: authenticated, '
      'public.is_hospital_admin() and (storage.foldername(name))[1] = public.app_hospital_id()::text';
end;
$$;
