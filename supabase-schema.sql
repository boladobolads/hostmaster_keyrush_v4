-- HostMaster + KeyRush V4 | Supabase PostgreSQL
-- Execute este arquivo no SQL Editor do Supabase, em um projeto novo.
-- O perfil Gestor Master é promovido manualmente no fim deste arquivo.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null unique,
  phone text not null default '',
  role text not null default 'proprietario' check (role in ('gestor','proprietario','prestador')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_master()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() = 'gestor', false) $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_role text;
begin
  v_role := case when new.raw_user_meta_data->>'role' in ('proprietario','prestador') then new.raw_user_meta_data->>'role' else 'proprietario' end;
  insert into public.profiles(id, full_name, email, phone, role)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''), lower(new.email), coalesce(new.raw_user_meta_data->>'phone',''), v_role)
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, phone = excluded.phone;
  return new;
end; $$;

drop trigger if exists on_auth_user_created_hostmaster on auth.users;
create trigger on_auth_user_created_hostmaster after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  address text not null,
  airbnb_url text not null default '',
  daily_rate numeric(12,2) not null default 0,
  status text not null default 'Disponível',
  image_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists properties_owner_idx on public.properties(owner_id);

create table if not exists public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'KeyRush',
  description text not null default '',
  price numeric(12,2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  service_id uuid references public.service_catalog(id) on delete set null,
  service_name text not null,
  fee numeric(12,2) not null default 0 check (fee >= 0),
  status text not null default 'searching' check (status in ('searching','accepted','in_progress','completed','cancelled')),
  property_title text not null,
  property_address text not null,
  owner_name text not null,
  offered_to_provider_id uuid references public.profiles(id),
  provider_id uuid references public.profiles(id),
  provider_name text not null default '',
  provider_lat double precision,
  provider_lng double precision,
  provider_distance_km numeric(10,2),
  provider_eta_minutes integer,
  provider_eta_label text not null default '',
  provider_location_updated_at timestamptz,
  provider_cancellation_count integer not null default 0,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists service_requests_owner_idx on public.service_requests(owner_id, created_at desc);
create index if not exists service_requests_provider_idx on public.service_requests(provider_id, status);
create index if not exists service_requests_offer_idx on public.service_requests(offered_to_provider_id, status);

create table if not exists public.provider_dispatch (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  provider_id uuid not null references public.profiles(id) on delete cascade,
  queue_position integer not null,
  state text not null default 'queued' check (state in ('queued','offered','accepted','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(request_id, provider_id),
  unique(request_id, queue_position)
);
create index if not exists provider_dispatch_provider_idx on public.provider_dispatch(provider_id, state);

create table if not exists public.service_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.service_requests(id) on delete restrict,
  owner_id uuid not null references public.profiles(id),
  provider_id uuid not null references public.profiles(id),
  service_name text not null,
  property_title text not null,
  fee numeric(12,2) not null,
  completed_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source text not null check (source in ('airbnb','manual')),
  external_uid text,
  start_date date not null,
  end_date date not null,
  summary text not null default '',
  reason text not null default '',
  sync_batch_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (end_date > start_date)
);
create unique index if not exists calendar_airbnb_uid_unique on public.calendar_events(property_id, source, external_uid);
create index if not exists calendar_property_dates_idx on public.calendar_events(property_id, start_date, end_date);

-- A URL iCal é privada: prestadores não podem ler esta tabela.
create table if not exists public.property_calendar_sources (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  ical_url text not null,
  last_synced_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  property_id uuid references public.properties(id) on delete set null,
  entry_type text not null check (entry_type in ('income','expense')),
  description text not null,
  category text not null default 'Geral',
  amount numeric(12,2) not null check (amount >= 0),
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists financial_entries_owner_date_idx on public.financial_entries(owner_id, entry_date desc);

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Catálogo inicia vazio. O Gestor Master cadastra os serviços e preços reais pelo painel.

-- Trigger de histórico e auditoria de conclusão.
create or replace function public.capture_service_completion()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.service_history(request_id, owner_id, provider_id, service_name, property_title, fee, completed_at)
    values(new.id, new.owner_id, new.provider_id, new.service_name, new.property_title, new.fee, coalesce(new.completed_at, now()))
    on conflict (request_id) do nothing;
    insert into public.audit_logs(actor_id, entity_type, entity_id, action, details)
    values(auth.uid(), 'service_request', new.id::text, 'completed', jsonb_build_object('service',new.service_name,'fee',new.fee));
  end if;
  return new;
end; $$;
drop trigger if exists service_completion_history on public.service_requests;
create trigger service_completion_history after update of status on public.service_requests
for each row execute procedure public.capture_service_completion();

-- Solicitação: somente proprietário (dos seus imóveis) ou Gestor Master.
create or replace function public.create_service_request(
  p_property_id uuid,
  p_service_id uuid default null,
  p_service_name text default null,
  p_fee numeric default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_role text; v_profile public.profiles; v_property public.properties; v_service public.service_catalog;
  v_name text; v_fee numeric(12,2); v_request public.service_requests; v_provider record; v_position integer := 0;
begin
  select * into v_profile from public.profiles where id = auth.uid() and is_active = true;
  if not found then raise exception 'Perfil não autorizado.'; end if;
  v_role := v_profile.role;
  if v_role not in ('gestor','proprietario') then raise exception 'Somente Proprietário ou Gestor Master pode solicitar serviços.'; end if;
  select * into v_property from public.properties where id = p_property_id;
  if not found then raise exception 'Imóvel não encontrado.'; end if;
  if v_role = 'proprietario' and v_property.owner_id <> auth.uid() then raise exception 'Você não tem acesso a este imóvel.'; end if;
  if p_service_id is not null then
    select * into v_service from public.service_catalog where id = p_service_id and active = true;
    if not found then raise exception 'Serviço indisponível.'; end if;
    v_name := v_service.name; v_fee := v_service.price;
  else
    if v_role <> 'gestor' then raise exception 'Proprietários devem escolher um serviço do catálogo.'; end if;
    v_name := nullif(trim(p_service_name),''); v_fee := greatest(coalesce(p_fee,0),0);
    if v_name is null then raise exception 'Informe o serviço.'; end if;
  end if;
  insert into public.service_requests(property_id, owner_id, service_id, service_name, fee, property_title, property_address, owner_name)
  values(v_property.id, v_property.owner_id, p_service_id, v_name, v_fee, v_property.title, v_property.address, v_profile.full_name)
  returning * into v_request;
  for v_provider in select id,email from public.profiles where role='prestador' and is_active=true order by created_at asc loop
    v_position := v_position + 1;
    insert into public.provider_dispatch(request_id,provider_id,queue_position,state)
    values(v_request.id,v_provider.id,v_position,case when v_position=1 then 'offered' else 'queued' end);
    if v_position=1 then
      update public.service_requests set offered_to_provider_id=v_provider.id where id=v_request.id returning * into v_request;
    end if;
  end loop;
  insert into public.audit_logs(actor_id,entity_type,entity_id,action,details)
  values(auth.uid(),'service_request',v_request.id::text,'created',jsonb_build_object('service',v_name,'fee',v_fee));
  return jsonb_build_object('id',v_request.id,'status',v_request.status,'service_name',v_request.service_name,'property_title',v_request.property_title,'fee',v_request.fee,'offered_to_provider_id',v_request.offered_to_provider_id);
end; $$;

create or replace function public.accept_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_request public.service_requests; v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id=auth.uid() and role='prestador' and is_active=true;
  if not found then raise exception 'Somente prestador ativo pode aceitar chamados.'; end if;
  select * into v_request from public.service_requests where id=p_request_id for update;
  if not found or v_request.status <> 'searching' or v_request.offered_to_provider_id <> auth.uid() then raise exception 'Este chamado não está mais disponível para sua conta.'; end if;
  update public.service_requests set status='accepted', provider_id=auth.uid(), provider_name=v_profile.full_name, accepted_at=now(), updated_at=now()
  where id=p_request_id returning * into v_request;
  update public.provider_dispatch set state='accepted',updated_at=now() where request_id=p_request_id and provider_id=auth.uid();
  insert into public.audit_logs(actor_id,entity_type,entity_id,action) values(auth.uid(),'service_request',p_request_id::text,'accepted');
  return jsonb_build_object('id',v_request.id,'status',v_request.status);
end; $$;

create or replace function public.cancel_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_request public.service_requests; v_next public.provider_dispatch; v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id=auth.uid() and role='prestador' and is_active=true;
  if not found then raise exception 'Somente prestador pode cancelar o atendimento.'; end if;
  select * into v_request from public.service_requests where id=p_request_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if not ((v_request.status='accepted' and v_request.provider_id=auth.uid()) or (v_request.status='searching' and v_request.offered_to_provider_id=auth.uid())) then
    raise exception 'Este chamado não está atribuído à sua conta.';
  end if;
  update public.provider_dispatch set state='cancelled',updated_at=now() where request_id=p_request_id and provider_id=auth.uid();
  select * into v_next from public.provider_dispatch where request_id=p_request_id and state='queued' order by queue_position asc limit 1 for update;
  update public.service_requests set status='searching', provider_id=null, provider_name='', provider_lat=null, provider_lng=null,
    provider_distance_km=null, provider_eta_minutes=null, provider_eta_label='', provider_location_updated_at=null,
    provider_cancellation_count=provider_cancellation_count+1,
    offered_to_provider_id=v_next.provider_id, updated_at=now()
  where id=p_request_id returning * into v_request;
  if v_next.id is not null then update public.provider_dispatch set state='offered',updated_at=now() where id=v_next.id; end if;
  insert into public.audit_logs(actor_id,entity_type,entity_id,action,details)
  values(auth.uid(),'service_request',p_request_id::text,'provider_cancelled',jsonb_build_object('next_provider_id',v_next.provider_id));
  return jsonb_build_object('id',v_request.id,'status',v_request.status,'offered_to_provider_id',v_request.offered_to_provider_id);
end; $$;

create or replace function public.complete_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_request public.service_requests;
begin
  update public.service_requests set status='completed',completed_at=now(),updated_at=now()
  where id=p_request_id and provider_id=auth.uid() and status='accepted'
  returning * into v_request;
  if not found then raise exception 'Somente o prestador responsável pode finalizar este atendimento.'; end if;
  update public.provider_dispatch set state='completed',updated_at=now() where request_id=p_request_id and provider_id=auth.uid();
  return jsonb_build_object('id',v_request.id,'status',v_request.status);
end; $$;

create or replace function public.update_service_location(
  p_request_id uuid,p_lat double precision,p_lng double precision,p_distance_km numeric,p_eta_minutes integer,p_eta_label text
) returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.service_requests set provider_lat=p_lat,provider_lng=p_lng,provider_distance_km=p_distance_km,
    provider_eta_minutes=p_eta_minutes,provider_eta_label=coalesce(p_eta_label,''),provider_location_updated_at=now(),updated_at=now()
  where id=p_request_id and provider_id=auth.uid() and status='accepted';
  if not found then raise exception 'Localização não autorizada para este chamado.'; end if;
end; $$;

-- Quando um novo prestador se cadastra, ele entra no fim da fila dos chamados ainda sem oferta.
create or replace function public.append_new_provider_to_open_requests()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_req record; v_pos integer;
begin
  if new.role='prestador' and new.is_active=true then
    for v_req in select id,offered_to_provider_id from public.service_requests where status='searching' order by created_at asc loop
      select coalesce(max(queue_position),0)+1 into v_pos from public.provider_dispatch where request_id=v_req.id;
      insert into public.provider_dispatch(request_id,provider_id,queue_position,state)
      values(v_req.id,new.id,v_pos,case when v_req.offered_to_provider_id is null then 'offered' else 'queued' end) on conflict(request_id,provider_id) do nothing;
      update public.service_requests set offered_to_provider_id=new.id,updated_at=now() where id=v_req.id and offered_to_provider_id is null;
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists profile_new_provider_dispatch on public.profiles;
create trigger profile_new_provider_dispatch after insert on public.profiles
for each row execute procedure public.append_new_provider_to_open_requests();

-- RLS
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.service_catalog enable row level security;
alter table public.service_requests enable row level security;
alter table public.provider_dispatch enable row level security;
alter table public.service_history enable row level security;
alter table public.calendar_events enable row level security;
alter table public.property_calendar_sources enable row level security;
alter table public.audit_logs enable row level security;
alter table public.financial_entries enable row level security;

drop policy if exists profiles_read_self_or_master on public.profiles;
create policy profiles_read_self_or_master on public.profiles for select to authenticated using (id=auth.uid() or public.is_master());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid() and role=public.current_app_role());

drop policy if exists properties_select_scope on public.properties;
create policy properties_select_scope on public.properties for select to authenticated using (owner_id=auth.uid() or public.is_master());
drop policy if exists properties_insert_scope on public.properties;
create policy properties_insert_scope on public.properties for insert to authenticated with check (owner_id=auth.uid() or public.is_master());
drop policy if exists properties_update_scope on public.properties;
create policy properties_update_scope on public.properties for update to authenticated using (owner_id=auth.uid() or public.is_master()) with check (owner_id=auth.uid() or public.is_master());
drop policy if exists properties_delete_scope on public.properties;
create policy properties_delete_scope on public.properties for delete to authenticated using (owner_id=auth.uid() or public.is_master());

drop policy if exists catalog_read_active on public.service_catalog;
create policy catalog_read_active on public.service_catalog for select to authenticated using (active=true or public.is_master());
drop policy if exists catalog_master_all on public.service_catalog;
create policy catalog_master_all on public.service_catalog for all to authenticated using (public.is_master()) with check (public.is_master());

drop policy if exists requests_read_scope on public.service_requests;
create policy requests_read_scope on public.service_requests for select to authenticated using (owner_id=auth.uid() or provider_id=auth.uid() or offered_to_provider_id=auth.uid() or public.is_master());
-- Criação e mudanças de status são feitas somente pelas RPCs transacionais.

drop policy if exists dispatch_read_scope on public.provider_dispatch;
create policy dispatch_read_scope on public.provider_dispatch for select to authenticated using (provider_id=auth.uid() or public.is_master());

drop policy if exists history_read_scope on public.service_history;
create policy history_read_scope on public.service_history for select to authenticated using (provider_id=auth.uid() or owner_id=auth.uid() or public.is_master());

drop policy if exists calendar_read_scope on public.calendar_events;
create policy calendar_read_scope on public.calendar_events for select to authenticated using (exists(select 1 from public.properties p where p.id=property_id and (p.owner_id=auth.uid() or public.is_master())));
drop policy if exists calendar_insert_manual_scope on public.calendar_events;
create policy calendar_insert_manual_scope on public.calendar_events for insert to authenticated with check (source='manual' and exists(select 1 from public.properties p where p.id=property_id and (p.owner_id=auth.uid() or public.is_master())));
drop policy if exists calendar_delete_manual_scope on public.calendar_events;
create policy calendar_delete_manual_scope on public.calendar_events for delete to authenticated using (source='manual' and exists(select 1 from public.properties p where p.id=property_id and (p.owner_id=auth.uid() or public.is_master())));

drop policy if exists calendar_sources_read_scope on public.property_calendar_sources;
create policy calendar_sources_read_scope on public.property_calendar_sources for select to authenticated using (public.is_master() or exists(select 1 from public.properties p where p.id=property_id and p.owner_id=auth.uid()));
drop policy if exists calendar_sources_insert_scope on public.property_calendar_sources;
create policy calendar_sources_insert_scope on public.property_calendar_sources for insert to authenticated with check (exists(select 1 from public.properties p where p.id=property_id and p.owner_id=owner_id and (p.owner_id=auth.uid() or public.is_master())));
drop policy if exists calendar_sources_update_scope on public.property_calendar_sources;
create policy calendar_sources_update_scope on public.property_calendar_sources for update to authenticated using (public.is_master() or exists(select 1 from public.properties p where p.id=property_id and p.owner_id=auth.uid())) with check (exists(select 1 from public.properties p where p.id=property_id and p.owner_id=owner_id and (p.owner_id=auth.uid() or public.is_master())));
drop policy if exists calendar_sources_delete_scope on public.property_calendar_sources;
create policy calendar_sources_delete_scope on public.property_calendar_sources for delete to authenticated using (public.is_master() or exists(select 1 from public.properties p where p.id=property_id and p.owner_id=auth.uid()));

drop policy if exists financial_read_scope on public.financial_entries;
create policy financial_read_scope on public.financial_entries for select to authenticated using (owner_id=auth.uid() or public.is_master());
drop policy if exists financial_insert_scope on public.financial_entries;
create policy financial_insert_scope on public.financial_entries for insert to authenticated with check ((owner_id=auth.uid() or public.is_master()) and created_by=auth.uid());
drop policy if exists financial_update_scope on public.financial_entries;
create policy financial_update_scope on public.financial_entries for update to authenticated using (owner_id=auth.uid() or public.is_master()) with check (owner_id=auth.uid() or public.is_master());
drop policy if exists financial_delete_scope on public.financial_entries;
create policy financial_delete_scope on public.financial_entries for delete to authenticated using (owner_id=auth.uid() or public.is_master());

drop policy if exists audit_read_master on public.audit_logs;
create policy audit_read_master on public.audit_logs for select to authenticated using (public.is_master());

revoke all on public.provider_dispatch from anon, authenticated;
grant select on public.provider_dispatch to authenticated;
grant select,insert,update,delete on public.properties to authenticated;
grant select,insert,update,delete on public.service_catalog to authenticated;
revoke all on public.service_requests from anon, authenticated;
grant select on public.service_requests to authenticated;
grant select on public.service_history to authenticated;
grant select,insert,delete on public.calendar_events to authenticated;
grant select,insert,update,delete on public.property_calendar_sources to authenticated;
grant select on public.profiles to authenticated;
grant update(full_name,phone) on public.profiles to authenticated;
grant select on public.audit_logs to authenticated;
grant select,insert,update,delete on public.financial_entries to authenticated;
grant execute on function public.create_service_request(uuid,uuid,text,numeric) to authenticated;
grant execute on function public.accept_service_request(uuid) to authenticated;
grant execute on function public.cancel_service_request(uuid) to authenticated;
grant execute on function public.complete_service_request(uuid) to authenticated;
grant execute on function public.update_service_location(uuid,double precision,double precision,numeric,integer,text) to authenticated;

-- Habilita Realtime para atualizações entre dispositivos.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='service_requests') then alter publication supabase_realtime add table public.service_requests; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='properties') then alter publication supabase_realtime add table public.properties; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='calendar_events') then alter publication supabase_realtime add table public.calendar_events; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='service_catalog') then alter publication supabase_realtime add table public.service_catalog; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='financial_entries') then alter publication supabase_realtime add table public.financial_entries; end if;
end $$;

-- IMPORTANTE: depois de criar o usuário gestor no Supabase Auth, execute:
-- update public.profiles set role='gestor' where email='SEU_EMAIL_MASTER';
-- Nunca permita que o cadastro público escolha o papel gestor.
