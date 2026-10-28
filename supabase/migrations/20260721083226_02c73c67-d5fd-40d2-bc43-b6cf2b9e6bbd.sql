
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  chosen_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  chosen_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'owner' THEN 'owner'::public.app_role
    WHEN NEW.raw_user_meta_data->>'role' = 'manager' THEN 'manager'::public.app_role
    WHEN NEW.raw_user_meta_data->>'role' = 'worker' THEN 'worker'::public.app_role
    ELSE 'worker'::public.app_role
  END;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, chosen_role);
  RETURN NEW;
END; $function$;
