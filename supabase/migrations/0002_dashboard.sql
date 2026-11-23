-- Dashboard support: settings (encrypted secrets), media assets, attribution, link-in-bio clicks.

create table settings (
  key text primary key,
  value text not null,            -- secrets are AES-256-GCM encrypted (v1:iv:tag:ciphertext)
  is_secret boolean not null default false,
  updated_at timestamptz not null default now()
);

create type asset_kind as enum ('app_demo', 'broll', 'screenshot');
create table assets (
  id uuid primary key default gen_random_uuid(),
  kind asset_kind not null,
  label text not null,
  storage_path text not null unique,
  content_type text not null,
  created_at timestamptz default now()
);

-- Installs/clicks per tracked-link code (utm_content), imported from Branch/AppsFlyer/App Store Connect.
create table attribution (
  code text primary key,
  clicks bigint not null default 0,
  installs bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Clicks through the dashboard's link-in-bio redirect (/go).
create table link_clicks (
  id bigserial primary key,
  code text not null,
  platform text,
  clicked_at timestamptz not null default now()
);
create index on link_clicks (code);

insert into storage.buckets (id, name, public) values ('assets', 'assets', false) on conflict do nothing;

alter table settings enable row level security;
alter table assets enable row level security;
alter table attribution enable row level security;
alter table link_clicks enable row level security;
