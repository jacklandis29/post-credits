-- Device-local diary imports can be retried safely after a crash or reload.
alter table public.watch_entries
  add column client_import_id text;

alter table public.watch_entries
  add constraint watch_entries_client_import_id_length
  check (
    client_import_id is null
    or pg_catalog.char_length(client_import_id) between 1 and 200
  );

create unique index watch_entries_user_client_import_unique
  on public.watch_entries (user_id, client_import_id)
  where client_import_id is not null;

comment on column public.watch_entries.client_import_id is
  'Opaque device-local entry ID used only to make account imports idempotent.';
