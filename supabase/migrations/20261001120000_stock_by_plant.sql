-- T14: stock is scoped by plant. Every stock item belongs to exactly one plant, and a
-- signed-in user sees only their own plant unless they are the owner. REEF confirmed in
-- writing that each plant's stock is managed separately and plants must not see each
-- other's levels.

ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS plant text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plant text;
