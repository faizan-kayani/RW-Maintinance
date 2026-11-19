-- Supabase > SQL Editor mein ye poora paste kar ke RUN karein

create table if not exists public.bills (
  id uuid primary key,
  no text not null unique,
  bill_date date not null default current_date,
  due date,
  cname text not null,
  cphone text default '',
  cemail text default '',
  items jsonb not null default '[]',
  disc numeric default 0,
  tax numeric default 0,
  status text not null default 'pending' check (status in ('pending','paid')),
  notes text default '',
  paid_on date,
  last_reminded timestamptz,
  remind_count int default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key check (id = 1),
  name text default 'RW Maintenance',
  phone text default '',
  addr text default '',
  cur text default 'Rs',
  pre text default 'INV-',
  print_mode text default 'a4',
  paper text default '58',
  auto_remind boolean default true,
  remind_every int default 3,
  sender_name text default 'RW Maintenance'
);
insert into public.settings (id) values (1) on conflict do nothing;

-- Sirf login kiye hue staff data dekh/badal sakte hain
alter table public.bills enable row level security;
alter table public.settings enable row level security;

drop policy if exists "staff bills" on public.bills;
create policy "staff bills" on public.bills for all to authenticated using (true) with check (true);
drop policy if exists "staff settings" on public.settings;
create policy "staff settings" on public.settings for all to authenticated using (true) with check (true);
