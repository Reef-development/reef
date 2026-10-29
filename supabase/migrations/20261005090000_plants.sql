-- Make a plant a thing rather than a spelling, and give a mine one.
--
-- T14 scopes people, stock and purchase orders by a plant held as free text on `profiles`,
-- `stock_items` and `purchase_orders`. The rules it added are right. The problem is the key.
--
-- A free text key compared across tables fails silently. The first time somebody types
-- "Mokopane 1" into a profile where the stock says "Mokopane Plant 1", that person's stock list
-- goes empty, their purchase orders disappear and no error is raised anywhere, because an access
-- rule that matches nothing looks exactly like an access rule working. Nothing in the system can
-- tell those two cases apart.
--
-- Two things are done here, and neither disturbs T14's columns, policies or tests.
--
-- 1. The set of plants becomes a table, and every plant column points at it. The columns stay
--    text and the values stay the names, so every existing policy comparing `plant = ...` keeps
--    working exactly as written. What changes is that a plant nobody has heard of is now refused
--    when it is written, instead of accepted and then matching nothing for ever.
--
-- 2. A mine gains its plant. Equipment, production, downtime, fuel and maintenance all hang off
--    `mine_id`, while people hang off `plant`, and until now nothing joined the two. That is why
--    the service reminders in T24 had to go to every manager: there was no way to ask which
--    managers belong to the plant a machine sits at.

-- ---------- The plants ----------

CREATE TABLE IF NOT EXISTS public.plants (
  -- The name is the key on purpose. Every plant column already holds the name, so this makes
  -- them foreign keys without rewriting a single column or policy.
  name text PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seeded from whatever is already in use, so adding the keys below cannot refuse a row that is
-- already there. Running this against an empty database simply inserts nothing.
INSERT INTO public.plants (name)
SELECT DISTINCT plant FROM public.stock_items WHERE plant IS NOT NULL
UNION
SELECT DISTINCT plant FROM public.purchase_orders WHERE plant IS NOT NULL
UNION
SELECT DISTINCT plant FROM public.profiles WHERE plant IS NOT NULL
ON CONFLICT (name) DO NOTHING;

GRANT SELECT ON public.plants TO authenticated;
GRANT ALL ON public.plants TO service_role;
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;

-- Everybody signed in may read the list: a worker's stock screen names their plant, and a
-- manager needs to see it to know what they are looking at. Nobody but the owner may change it,
-- because adding a plant decides who can see what.
CREATE POLICY "Anyone signed in reads plants" ON public.plants FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Owners manage plants" ON public.plants FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'owner'::public.app_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'owner'::public.app_role
    )
  );

-- ---------- A mine belongs to a plant ----------

ALTER TABLE public.mines ADD COLUMN IF NOT EXISTS plant text;

COMMENT ON COLUMN public.mines.plant IS
  'Which plant operates this site. Joins the mine side of the system (equipment, production, downtime, fuel, maintenance) to the plant side (people, stock, purchase orders). Null means nobody has said yet, and the service reminders for it go to the owner alone.';

-- ---------- The keys ----------
--
-- Referential integrity is not subject to row-level security, so these checks hold for every
-- writer including the service role. A typo is refused at the moment it is written, by the
-- database, rather than discovered weeks later by somebody wondering where their stock went.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plant_fkey,
  ADD CONSTRAINT profiles_plant_fkey
  FOREIGN KEY (plant) REFERENCES public.plants(name) ON UPDATE CASCADE;

ALTER TABLE public.stock_items
  DROP CONSTRAINT IF EXISTS stock_items_plant_fkey,
  ADD CONSTRAINT stock_items_plant_fkey
  FOREIGN KEY (plant) REFERENCES public.plants(name) ON UPDATE CASCADE;

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_plant_fkey,
  ADD CONSTRAINT purchase_orders_plant_fkey
  FOREIGN KEY (plant) REFERENCES public.plants(name) ON UPDATE CASCADE;

ALTER TABLE public.mines
  DROP CONSTRAINT IF EXISTS mines_plant_fkey,
  ADD CONSTRAINT mines_plant_fkey
  FOREIGN KEY (plant) REFERENCES public.plants(name) ON UPDATE CASCADE;

-- ON UPDATE CASCADE is the point of using the name as the key: renaming a plant renames it
-- everywhere in one statement, which is the one operation a text key would otherwise make
-- dangerous.

CREATE INDEX IF NOT EXISTS idx_mines_plant ON public.mines (plant);
CREATE INDEX IF NOT EXISTS idx_profiles_plant ON public.profiles (plant);
