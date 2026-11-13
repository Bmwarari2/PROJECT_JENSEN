-- Laoshi — initial schema.
--
-- One learner. Every read and write goes through the Next.js server using the
-- Supabase secret key, so RLS is enabled with no policies: the public
-- (anon/publishable) key can't read or change anything.

-- ---------------------------------------------------------------------------
-- Learner state: a single row holding course position and the tutor's notes.
-- ---------------------------------------------------------------------------
create table public.learner_state (
  id smallint primary key default 1 check (id = 1),
  current_unit smallint not null default 1 check (current_unit >= 1),
  tutor_notes text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.learner_state (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Conversations ("study sessions") and their messages.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  model text not null,
  -- Frozen when the session starts. Claude's reasoning blocks are bound to the
  -- exact prompt prefix, so this is never edited while the session continues;
  -- a new session gets a new prompt with a fresh snapshot of your progress.
  system_prompt text not null,
  message_count integer not null default 0 check (message_count >= 0)
);
create index conversations_last_message_at_idx on public.conversations (last_message_at desc);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  seq integer not null check (seq >= 1),
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null, -- exact API content blocks, replayed verbatim to Claude
  display jsonb not null, -- what the UI renders for this message
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

-- ---------------------------------------------------------------------------
-- Vocabulary with a simple spaced-repetition schedule.
-- ---------------------------------------------------------------------------
create table public.vocabulary (
  id bigint generated always as identity primary key,
  hanzi text not null unique,
  pinyin text not null default '',
  english text not null default '',
  introduced_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  times_seen integer not null default 1,
  practice_attempts integer not null default 0,
  practice_passes integer not null default 0,
  last_score real,
  best_score real,
  interval_days real not null default 0,
  next_review_at timestamptz not null default (now() + interval '1 day')
);
create index vocabulary_next_review_at_idx on public.vocabulary (next_review_at);

-- ---------------------------------------------------------------------------
-- Every pronunciation attempt, with per-character scores.
-- ---------------------------------------------------------------------------
create table public.pronunciation_attempts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  conversation_id uuid references public.conversations (id) on delete set null,
  target_hanzi text not null,
  target_pinyin text not null default '',
  target_english text not null default '',
  recognized_text text not null default '',
  pron_score real,
  accuracy_score real,
  fluency_score real,
  completeness_score real,
  words jsonb not null default '[]'::jsonb,
  -- 'assessment' = Azure pronunciation assessment (phoneme-level scores);
  -- 'recognition' = clarity check from speech recognition (ElevenLabs).
  method text not null default 'assessment' check (method in ('assessment', 'recognition'))
);
create index pronunciation_attempts_created_at_idx on public.pronunciation_attempts (created_at desc);

alter table public.learner_state enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.vocabulary enable row level security;
alter table public.pronunciation_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- append_messages: atomically append turns to a conversation.
-- p_expected_count is the message_count the caller built its request from; if
-- another request appended in the meantime the call fails instead of
-- interleaving turns (which would break the append-only history Claude needs).
-- ---------------------------------------------------------------------------
create or replace function public.append_messages(
  p_conversation_id uuid,
  p_expected_count integer,
  p_messages jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
  added integer := jsonb_array_length(p_messages);
begin
  select c.message_count into current_count
  from public.conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception 'conversation % not found', p_conversation_id using errcode = 'P0002';
  end if;
  if current_count <> p_expected_count then
    raise exception 'conversation changed concurrently (expected %, found %)',
      p_expected_count, current_count using errcode = '40001';
  end if;

  insert into public.messages (conversation_id, seq, role, content, display)
  select p_conversation_id, current_count + m.ord, m.value ->> 'role', m.value -> 'content', m.value -> 'display'
  from jsonb_array_elements(p_messages) with ordinality as m (value, ord);

  update public.conversations
  set message_count = current_count + added, last_message_at = now()
  where id = p_conversation_id;

  return current_count + added;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_vocabulary: upsert words the tutor taught or used this turn.
-- ---------------------------------------------------------------------------
create or replace function public.record_vocabulary(items jsonb) returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.vocabulary (hanzi, pinyin, english)
  select distinct on (btrim(i ->> 'hanzi'))
    btrim(i ->> 'hanzi'),
    btrim(coalesce(i ->> 'pinyin', '')),
    btrim(coalesce(i ->> 'english', ''))
  from jsonb_array_elements(items) as i
  where btrim(coalesce(i ->> 'hanzi', '')) <> ''
  on conflict (hanzi) do update
  set last_seen_at = now(),
      times_seen = public.vocabulary.times_seen + 1,
      pinyin = case when public.vocabulary.pinyin = '' then excluded.pinyin else public.vocabulary.pinyin end,
      english = case when public.vocabulary.english = '' then excluded.english else public.vocabulary.english end;
$$;

-- ---------------------------------------------------------------------------
-- activity_days: distinct local dates with study activity (for streaks).
-- ---------------------------------------------------------------------------
create or replace function public.activity_days(tz text default 'UTC')
returns table (day date)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.day from (
    select (m.created_at at time zone tz)::date as day
    from public.messages m
    where m.role = 'user'
    union
    select (p.created_at at time zone tz)::date
    from public.pronunciation_attempts p
  ) d
  order by d.day desc
  limit 400;
$$;

-- Only the server (service_role / secret key) may call these.
revoke all on function public.append_messages(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.record_vocabulary(jsonb) from public, anon, authenticated;
revoke all on function public.activity_days(text) from public, anon, authenticated;
grant execute on function public.append_messages(uuid, integer, jsonb) to service_role;
grant execute on function public.record_vocabulary(jsonb) to service_role;
grant execute on function public.activity_days(text) to service_role;
