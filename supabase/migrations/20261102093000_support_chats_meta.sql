-- Extra support-chat fields for production inbox (status, geo, typing, flags).

alter table public.support_chats
  add column if not exists status text not null default 'open';

alter table public.support_chats
  add column if not exists meta jsonb not null default '{}'::jsonb;

update public.support_chats
set status = coalesce(nullif(status, ''), 'open')
where status is null or status = '';

create index if not exists support_chats_status_idx on public.support_chats (status);

comment on column public.support_chats.status is 'open | ended';
comment on column public.support_chats.meta is
  'JSON bag: awaitingAgent, agentConnected, typingAgentAt, geo fields, endedAt';
