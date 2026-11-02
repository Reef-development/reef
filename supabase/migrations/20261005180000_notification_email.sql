-- T17: notifications go out by email, once, and a failed email is recorded against the
-- notification rather than breaking the sweep that raised it.
--
-- The notifications table already had emailed_at, but nothing sent anything: the sweep raised
-- notifications and stopped there. The sweep now emails each notification that has not gone
-- out yet and marks it, so the next sweep does not send it again. When the mail server refuses,
-- the reason is written here and the notification stays, still readable in the app.

alter table public.notifications
  add column if not exists email_failed_at timestamptz,
  add column if not exists email_error text;

-- What the sweep still has to send, with the address of the person each notification is for.
-- The address lives in auth.users, which the API cannot read through PostgREST, so this joins
-- it here. A notification that has failed is tried again on later sweeps for a week, so a mail
-- server that was down for a day does not lose that day's reminders, and a bad address does
-- not get retried for ever.
create or replace function public.notifications_to_email(_limit integer default 200)
returns table (id uuid, email text, subject text, body text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select n.id, u.email::text, n.subject, n.body
    from public.notifications n
    join auth.users u on u.id = n.user_id
   where n.emailed_at is null
     and u.email is not null
     and n.created_at > now() - interval '7 days'
   order by n.created_at
   limit _limit;
$$;

-- Only the sweep's own credential may list other people's addresses.
revoke all on function public.notifications_to_email(integer) from public, anon, authenticated;
grant execute on function public.notifications_to_email(integer) to service_role;
