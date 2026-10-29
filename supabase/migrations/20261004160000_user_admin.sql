-- T22 (administration): the owner lists the people who can sign in and changes their role.
--
-- Profiles and roles are readable only by their own user (row-level security), and that stays
-- true. The owner reaches everyone through two functions instead, each of which checks that
-- the caller is an owner first. This keeps one narrow door rather than widening the table
-- policies for every query.
--
-- A role change:
--   * is owner-only,
--   * must give a reason (as every change does since T6),
--   * may only set one of the three real roles,
--   * may never leave the platform without an owner,
--   * is written to the history, with the old and new role.
--
-- Accounts are still created by signing up; the API holds no service key, so it cannot
-- create sign-ins itself. The owner then sets the right role here.

create or replace function public.is_owner(_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user and role = 'owner');
$$;

revoke all on function public.is_owner(uuid) from public, anon, authenticated;

-- A person's role is their highest real role, the same rule as highestRole() in the API.
create or replace function public.role_of(_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.user_roles where user_id = _user and role = 'owner') then 'owner'
    when exists (select 1 from public.user_roles where user_id = _user and role = 'manager') then 'manager'
    when exists (select 1 from public.user_roles where user_id = _user and role = 'worker') then 'worker'
  end;
$$;

revoke all on function public.role_of(uuid) from public, anon, authenticated;

create or replace function public.list_users()
returns table (id uuid, full_name text, email text, role text, plant text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner(auth.uid()) then
    raise exception 'Only the owner can see everyone''s accounts' using errcode = '42501';
  end if;
  -- Plant is read through to_jsonb so this works before and after T14 adds the column.
  return query
    select p.id, p.full_name, p.email, public.role_of(p.id), to_jsonb(p) ->> 'plant', p.created_at
    from public.profiles p
    order by p.full_name nulls last, p.email;
end;
$$;

revoke all on function public.list_users() from public, anon;
grant execute on function public.list_users() to authenticated;

create or replace function public.set_user_role(_user uuid, _role text, _reason text)
returns table (id uuid, full_name text, email text, role text, plant text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  _old text;
begin
  if not public.is_owner(auth.uid()) then
    raise exception 'Only the owner can change someone''s role' using errcode = '42501';
  end if;
  if _role is null or _role not in ('owner', 'manager', 'worker') then
    raise exception 'A role must be owner, manager or worker' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(_reason, '')), '') is null then
    raise exception 'A reason is required when changing a record' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where profiles.id = _user) then
    raise exception 'That account does not exist' using errcode = 'RF404';
  end if;

  _old := public.role_of(_user);
  if _old = 'owner' and _role <> 'owner'
     and (select count(distinct user_id) from public.user_roles where user_roles.role = 'owner') <= 1 then
    raise exception 'There must always be at least one owner. Make someone else an owner first.'
      using errcode = 'RF409';
  end if;

  if _old is distinct from _role then
    delete from public.user_roles
     where user_id = _user and user_roles.role in ('owner', 'manager', 'worker');
    insert into public.user_roles (user_id, role) values (_user, _role::public.app_role);

    insert into public.history (table_name, row_id, changed_by, reason, old_values, new_values, version)
    values (
      'user_roles',
      _user,
      auth.uid(),
      btrim(_reason),
      jsonb_build_object('role', _old),
      jsonb_build_object('role', _role),
      (select count(*) + 1 from public.history h where h.table_name = 'user_roles' and h.row_id = _user)
    );
  end if;

  return query
    select p.id, p.full_name, p.email, public.role_of(p.id), to_jsonb(p) ->> 'plant', p.created_at
    from public.profiles p
    where p.id = _user;
end;
$$;

revoke all on function public.set_user_role(uuid, text, text) from public, anon;
grant execute on function public.set_user_role(uuid, text, text) to authenticated;
