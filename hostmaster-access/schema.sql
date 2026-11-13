-- HostMaster Access Standalone - execute SOMENTE no NOVO projeto Supabase
create extension if not exists pgcrypto;
create table if not exists public.access_properties(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 120),
 address text not null check(length(address) between 1 and 240),
 created_at timestamptz not null default now()
);
create table if not exists public.access_devices(
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.access_properties(id) on delete cascade,
 manufacturer text not null check(manufacturer in ('agl_home','primebras_rio')),
 device_name text not null check(length(device_name) between 1 and 100),
 device_type text not null default 'portao_social',
 model text not null default '',
 integration_status text not null default 'pending' check(integration_status in ('pending','ready','offline','unsupported')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.access_events(
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.access_properties(id) on delete cascade,
 device_id uuid references public.access_devices(id) on delete set null,
 actor_id uuid references auth.users(id) on delete set null,
 method text not null,
 result text not null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.access_properties enable row level security;
alter table public.access_devices enable row level security;
alter table public.access_events enable row level security;
drop policy if exists own_properties_all on public.access_properties;
create policy own_properties_all on public.access_properties for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
drop policy if exists own_devices_all on public.access_devices;
create policy own_devices_all on public.access_devices for all to authenticated using(exists(select 1 from public.access_properties p where p.id=property_id and p.owner_id=auth.uid())) with check(exists(select 1 from public.access_properties p where p.id=property_id and p.owner_id=auth.uid()));
drop policy if exists own_events_read on public.access_events;
create policy own_events_read on public.access_events for select to authenticated using(exists(select 1 from public.access_properties p where p.id=property_id and p.owner_id=auth.uid()));
revoke all on public.access_events from anon,authenticated;
grant select on public.access_events to authenticated;
grant select,insert,update,delete on public.access_properties,public.access_devices to authenticated;
