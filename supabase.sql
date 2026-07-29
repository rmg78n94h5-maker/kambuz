create extension if not exists pgcrypto;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  unit text not null,
  qty numeric not null default 0,
  min_qty numeric not null default 0,
  location text,
  barcode text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  item_name text,
  type text not null check (type in ('consumption','receipt','writeoff','adjustment')),
  quantity numeric not null,
  reason text,
  comment text,
  user_name text,
  unit text,
  previous_qty numeric,
  new_qty numeric,
  created_at timestamptz not null default now()
);

alter table public.items enable row level security;
alter table public.operations enable row level security;

create policy "kambuz items read" on public.items for select using (true);
create policy "kambuz items insert" on public.items for insert with check (true);
create policy "kambuz items update" on public.items for update using (true) with check (true);
create policy "kambuz items delete" on public.items for delete using (true);

create policy "kambuz operations read" on public.operations for select using (true);
create policy "kambuz operations insert" on public.operations for insert with check (true);
create policy "kambuz operations update" on public.operations for update using (true) with check (true);
create policy "kambuz operations delete" on public.operations for delete using (true);

alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.operations;
