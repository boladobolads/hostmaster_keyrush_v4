-- HostMaster Access v1 - migration additive (não substitui o schema V4)
create table if not exists public.access_devices (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  manufacturer text not null check (manufacturer in ('agl_home','primebras_rio')),
  device_name text not null,
  device_type text not null default 'portao_social',
  model text not null default '',
  external_device_id text not null default '',
  integration_status text not null default 'pending' check (integration_status in ('pending','ready','offline','unsupported')),
  notes text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists access_devices_property_idx on public.access_devices(property_id);
create index if not exists access_devices_manufacturer_idx on public.access_devices(manufacturer);

create table if not exists public.access_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  device_id uuid references public.access_devices(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_label text not null default '',
  method text not null default 'system',
  result text not null default 'pending',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists access_events_property_created_idx on public.access_events(property_id, created_at desc);
create index if not exists access_events_device_created_idx on public.access_events(device_id, created_at desc);

alter table public.access_devices enable row level security;
alter table public.access_events enable row level security;

drop policy if exists access_devices_read_scope on public.access_devices;
create policy access_devices_read_scope on public.access_devices for select to authenticated
using (public.is_master() or exists(select 1 from public.properties p where p.id=property_id and p.owner_id=auth.uid()));

drop policy if exists access_devices_insert_scope on public.access_devices;
create policy access_devices_insert_scope on public.access_devices for insert to authenticated
with check (created_by=auth.uid() and exists(select 1 from public.properties p where p.id=property_id and (public.is_master() or p.owner_id=auth.uid())));

drop policy if exists access_devices_update_scope on public.access_devices;
create policy access_devices_update_scope on public.access_devices for update to authenticated
using (public.is_master() or exists(select 1 from public.properties p where p.id=property_id and p.owner_id=auth.uid()))
with check (exists(select 1 from public.properties p where p.id=property_id and (public.is_master() or p.owner_id=auth.uid())));

drop policy if exists access_devices_delete_scope on public.access_devices;
create policy access_devices_delete_scope on public.access_devices for delete to authenticated
using (public.is_master() or exists(select 1 from public.properties p where p.id=property_id and p.owner_id=auth.uid()));

drop policy if exists access_events_read_scope on public.access_events;
create policy access_events_read_scope on public.access_events for select to authenticated
using (public.is_master() or exists(select 1 from public.properties p where p.id=property_id and p.owner_id=auth.uid()));

revoke all on public.access_devices from anon;
revoke all on public.access_events from anon, authenticated;
grant select,insert,update,delete on public.access_devices to authenticated;
grant select on public.access_events to authenticated;

-- Eventos de abertura devem ser gravados somente por função backend segura
-- após validação do convite e do comando do fabricante. Não habilitar INSERT direto.
