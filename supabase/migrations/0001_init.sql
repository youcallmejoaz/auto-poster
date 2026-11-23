-- Study-app short video pipeline schema
create extension if not exists pgcrypto;

create table research_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,              -- apify | csv | own
  platform text not null,            -- tiktok | instagram
  url text not null unique,
  author text,
  author_followers int,
  caption text,
  hook_text text,
  duration_sec numeric,
  views bigint default 0,
  likes bigint default 0,
  comments bigint default 0,
  shares bigint default 0,
  posted_at timestamptz,
  tags text[] default '{}',
  fetched_at timestamptz default now()
);

create table insights (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,             -- e.g. "POV relatable exam panic → app reveal"
  hook_type text,
  format text,                       -- maps to a renderer template where possible
  topic text,
  cta_style text,
  evidence_score numeric not null,   -- 0..1
  example_urls text[] default '{}',
  created_at timestamptz default now()
);

create type brief_origin as enum ('research', 'analytics', 'manual', 'rejection');
create type brief_status as enum ('open', 'in_progress', 'done', 'dropped');

create table briefs (
  id uuid primary key default gen_random_uuid(),
  origin brief_origin not null,
  instruction text not null,
  template text,                     -- preferred renderer template
  parent_video_id uuid,              -- set when the brief is an edit/variant of an existing video
  priority int not null default 50,  -- higher first
  status brief_status not null default 'open',
  created_at timestamptz default now()
);

create type video_status as enum ('draft', 'review', 'approved', 'rejected', 'scheduled', 'posted', 'failed');

create table videos (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid references briefs(id),
  parent_video_id uuid references videos(id),
  version int not null default 1,
  title text not null,
  template text not null,
  script jsonb not null,
  caption text,
  hashtags text[] default '{}',
  storage_path text,
  quality_score numeric,
  critique jsonb,
  status video_status not null default 'draft',
  review_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id),
  platform text not null,
  external_id text,
  tracked_link text,
  scheduled_for timestamptz,
  posted_at timestamptz,
  unique (video_id, platform)
);

create table metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id),
  snapshot_at timestamptz not null default now(),
  views bigint, likes bigint, comments bigint, shares bigint, saves bigint,
  avg_watch_sec numeric, completion_rate numeric,
  link_clicks bigint, installs bigint
);
create index on metrics (post_id, snapshot_at desc);

create table job_runs (
  id uuid primary key default gen_random_uuid(),
  stage text not null,
  status text not null,              -- running | ok | error
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cost_usd numeric default 0,
  items int default 0,
  error text
);
create index on job_runs (stage, started_at desc);

-- Storage bucket for rendered videos
insert into storage.buckets (id, name, public) values ('videos', 'videos', false) on conflict do nothing;

-- Service-role only: the worker and the dashboard server use the service key; deny anon/authenticated.
alter table research_items enable row level security;
alter table insights enable row level security;
alter table briefs enable row level security;
alter table videos enable row level security;
alter table posts enable row level security;
alter table metrics enable row level security;
alter table job_runs enable row level security;
