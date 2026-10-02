-- T12: Active sign-ins and session revocation

CREATE TABLE public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,

  session_id uuid NOT NULL UNIQUE,

  device text,

  address text,

  last_used_at timestamptz NOT NULL DEFAULT now(),

  revoked_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_sessions
ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.user_sessions TO authenticated;
GRANT ALL ON public.user_sessions TO service_role;

CREATE POLICY "Users can view own sessions"
ON public.user_sessions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
);

CREATE POLICY "Owners can view all sessions"
ON public.user_sessions
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
);

CREATE POLICY "Owners can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
);

CREATE OR REPLACE FUNCTION public.touch_user_session(
  _session_id uuid,
  _device text,
  _address text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _affected_rows integer;
  _jwt_session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  _jwt_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;

  IF _jwt_session_id IS NULL THEN
    RAISE EXCEPTION 'Session id missing from authentication token';
  END IF;

  IF _session_id <> _jwt_session_id THEN
    RAISE EXCEPTION 'Session id does not match authentication token';
  END IF;

  INSERT INTO public.user_sessions (
    user_id,
    session_id,
    device,
    address,
    last_used_at
  )
  VALUES (
    auth.uid(),
    _jwt_session_id,
    _device,
    _address,
    now()
  )
  ON CONFLICT (session_id)
  DO UPDATE SET
    device = EXCLUDED.device,
    address = EXCLUDED.address,
    last_used_at = now()
  WHERE public.user_sessions.user_id = auth.uid()
    AND public.user_sessions.revoked_at IS NULL;

  GET DIAGNOSTICS _affected_rows = ROW_COUNT;

  RETURN _affected_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_user_session(uuid, text, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.touch_user_session(uuid, text, text)
TO authenticated, service_role;

CREATE TABLE public.session_revocation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  actor_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,

  target_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,

  session_id uuid,

  revoke_all boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_revocation_history
ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.session_revocation_history TO authenticated;
GRANT ALL ON public.session_revocation_history TO service_role;

CREATE POLICY "Owners can view session revocation history"
ON public.session_revocation_history
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
);


CREATE OR REPLACE FUNCTION public.revoke_user_session(
  _session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Only an owner may revoke user sessions';
  END IF;

  UPDATE public.user_sessions
  SET revoked_at = now()
  WHERE session_id = _session_id
    AND revoked_at IS NULL
  RETURNING user_id INTO _target_user_id;

  IF _target_user_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.session_revocation_history (
    actor_user_id,
    target_user_id,
    session_id,
    revoke_all
  )
  VALUES (
    auth.uid(),
    _target_user_id,
    _session_id,
    false
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_session(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.revoke_user_session(uuid)
TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.revoke_all_user_sessions(
  _target_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _revoked_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Only an owner may revoke user sessions';
  END IF;

  UPDATE public.user_sessions
  SET revoked_at = now()
  WHERE user_id = _target_user_id
    AND revoked_at IS NULL;

  GET DIAGNOSTICS _revoked_count = ROW_COUNT;

  IF _revoked_count > 0 THEN
    INSERT INTO public.session_revocation_history (
      actor_user_id,
      target_user_id,
      session_id,
      revoke_all
    )
    VALUES (
      auth.uid(),
      _target_user_id,
      NULL,
      true
    );
  END IF;

  RETURN _revoked_count;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_all_user_sessions(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.revoke_all_user_sessions(uuid)
TO authenticated, service_role;
