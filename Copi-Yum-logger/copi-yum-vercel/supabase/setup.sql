-- Run once in the Supabase SQL Editor. The Vercel Function is the only data writer.
create schema if not exists private;

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  secret text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id),
  token_hash text not null unique,
  short_code text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by text,
  use_kind text check (use_kind in ('stamp','reward'))
);
create index if not exists tickets_card_id on public.tickets(card_id);
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.cards(id),
  ticket_id uuid unique references public.tickets(id),
  item text not null,
  amount_cents integer,
  staff text not null,
  created_at timestamptz not null default now()
);
create index if not exists sales_created_at on public.sales(created_at desc);
create table if not exists public.loyalty_events (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id),
  sale_id uuid references public.sales(id),
  kind text not null check (kind in ('stamp','reward','reversal')),
  staff text not null,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists one_stamp_per_sale on public.loyalty_events(sale_id) where kind='stamp';
create index if not exists loyalty_events_card_id on public.loyalty_events(card_id);
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  item text not null,
  category text not null,
  amount_cents integer not null,
  staff text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists expenses_created_at on public.expenses(created_at desc);

-- Supabase Data API clients have no direct access to loyalty or sales records.
alter table public.cards enable row level security;
alter table public.tickets enable row level security;
alter table public.sales enable row level security;
alter table public.loyalty_events enable row level security;
alter table public.expenses enable row level security;

create or replace function private.issue_ticket(p_secret text, p_hash text, p_short text)
returns table(id uuid, expires_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare v_card uuid;
begin
  select c.id into v_card from public.cards c where c.secret = p_secret for update;
  if v_card is null then raise exception 'Card not found.' using errcode = 'P0001'; end if;
  update public.tickets t set expires_at = now() where t.card_id = v_card and t.used_at is null and t.expires_at > now();
  return query insert into public.tickets(card_id, token_hash, short_code, expires_at)
    values (v_card, p_hash, p_short, now() + interval '2 minutes')
    returning tickets.id, tickets.expires_at;
end;
$$;

create or replace function private.redeem_ticket(
  p_hash text, p_short text, p_staff text, p_action text, p_item text, p_amount integer
)
returns table(card_id uuid, sale_id uuid)
language plpgsql
set search_path = ''
as $$
declare v_card uuid; v_ticket public.tickets%rowtype; v_sale uuid; v_paid integer; v_redeemed integer;
begin
  select t.card_id into v_card from public.tickets t
    where (p_hash is not null and t.token_hash = p_hash) or (p_short is not null and t.short_code = p_short);
  if v_card is null then raise exception 'QR not found. Ask the customer for a fresh QR.' using errcode = 'P0001'; end if;
  perform 1 from public.cards c where c.id = v_card for update;
  select t.* into v_ticket from public.tickets t
    where (p_hash is not null and t.token_hash = p_hash) or (p_short is not null and t.short_code = p_short) for update;
  if v_ticket.used_at is not null then raise exception 'Already scanned. No extra stamp was added.' using errcode = 'P0001'; end if;
  if v_ticket.expires_at <= now() then raise exception 'QR expired. Ask the customer to make a new one.' using errcode = 'P0001'; end if;
  if p_action not in ('stamp','reward') then raise exception 'Invalid action.' using errcode = 'P0001'; end if;
  if p_action = 'reward' then
    select count(*) filter (where kind='stamp') - count(*) filter (where kind='reversal'),
      count(*) filter (where kind='reward') into v_paid, v_redeemed
      from public.loyalty_events e where e.card_id = v_card;
    if v_paid < 5 * (v_redeemed + 1) then
      raise exception 'No free coffee is available on this card yet.' using errcode = 'P0001';
    end if;
  end if;
  update public.tickets t set used_at=now(), used_by=p_staff, use_kind=p_action where t.id=v_ticket.id;
  if p_action = 'stamp' then
    insert into public.sales(card_id, ticket_id, item, amount_cents, staff)
      values (v_card, v_ticket.id, p_item, p_amount, p_staff) returning id into v_sale;
    insert into public.loyalty_events(card_id, sale_id, kind, staff) values (v_card, v_sale, 'stamp', p_staff);
  else
    insert into public.loyalty_events(card_id, kind, staff, note)
      values (v_card, 'reward', p_staff, 'Free coffee redeemed');
  end if;
  return query select v_card, v_sale;
end;
$$;

create or replace function private.redeem_reward(p_card uuid, p_staff text)
returns void
language plpgsql
set search_path = ''
as $$
declare v_paid integer; v_redeemed integer;
begin
  perform 1 from public.cards c where c.id = p_card for update;
  if not found then raise exception 'Card not found.' using errcode = 'P0001'; end if;
  select count(*) filter (where kind='stamp') - count(*) filter (where kind='reversal'),
    count(*) filter (where kind='reward') into v_paid, v_redeemed
    from public.loyalty_events e where e.card_id = p_card;
  if v_paid < 5 * (v_redeemed + 1) then raise exception 'No free coffee is available yet.' using errcode = 'P0001'; end if;
  insert into public.loyalty_events(card_id, kind, staff, note)
    values (p_card, 'reward', p_staff, 'Free coffee redeemed');
end;
$$;

revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
