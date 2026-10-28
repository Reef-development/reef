
-- =========================================================
-- Reef Energy Engineering Fuels — schema
-- =========================================================

-- Update timestamp helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ---------- Roles (scaffold for future multi-role) ----------
CREATE TYPE public.app_role AS ENUM ('owner', 'manager', 'supervisor', 'stock_controller');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- ---------- Profiles ----------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto create profile + owner role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- Clients ----------
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contract_start DATE,
  contract_end DATE,
  contract_revenue_monthly NUMERIC(14,2) DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage clients" ON public.clients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Mines ----------
CREATE TABLE public.mines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  location TEXT,
  team_name TEXT,
  target_cost_per_ton NUMERIC(12,2),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mines TO authenticated;
GRANT ALL ON public.mines TO service_role;
ALTER TABLE public.mines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage mines" ON public.mines FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_mines_updated BEFORE UPDATE ON public.mines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Equipment ----------
CREATE TABLE public.equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mine_id UUID REFERENCES public.mines(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT,
  install_date DATE,
  expected_life_tons NUMERIC(14,2),
  expected_life_hours NUMERIC(14,2),
  tons_since_install NUMERIC(14,2) NOT NULL DEFAULT 0,
  hours_since_install NUMERIC(14,2) NOT NULL DEFAULT 0,
  service_interval_tons NUMERIC(14,2),
  service_interval_days INTEGER,
  replacement_cost NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment TO authenticated;
GRANT ALL ON public.equipment TO service_role;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage equipment" ON public.equipment FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_equipment_updated BEFORE UPDATE ON public.equipment FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Suppliers ----------
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage suppliers" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Stock items ----------
CREATE TABLE public.stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT DEFAULT 'unit',
  qty_on_hand NUMERIC(14,2) NOT NULL DEFAULT 0,
  reorder_point NUMERIC(14,2) NOT NULL DEFAULT 0,
  reorder_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_items TO authenticated;
GRANT ALL ON public.stock_items TO service_role;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage stock" ON public.stock_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_stock_items_updated BEFORE UPDATE ON public.stock_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Purchase orders ----------
CREATE TYPE public.po_status AS ENUM ('draft', 'approved', 'ordered', 'received', 'cancelled');

CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status public.po_status NOT NULL DEFAULT 'draft',
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage POs" ON public.purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_po_updated BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.po_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  stock_item_id UUID REFERENCES public.stock_items(id) ON DELETE SET NULL,
  qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_lines TO authenticated;
GRANT ALL ON public.po_lines TO service_role;
ALTER TABLE public.po_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage PO lines" ON public.po_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------- Maintenance ----------
CREATE TABLE public.maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  labour_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  labour_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  parts_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  downtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  next_due_date DATE,
  next_due_tons NUMERIC(14,2),
  performed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_logs TO authenticated;
GRANT ALL ON public.maintenance_logs TO service_role;
ALTER TABLE public.maintenance_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage maintenance" ON public.maintenance_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_maint_updated BEFORE UPDATE ON public.maintenance_logs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.maintenance_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_id UUID NOT NULL REFERENCES public.maintenance_logs(id) ON DELETE CASCADE,
  stock_item_id UUID REFERENCES public.stock_items(id) ON DELETE SET NULL,
  qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_parts TO authenticated;
GRANT ALL ON public.maintenance_parts TO service_role;
ALTER TABLE public.maintenance_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage maintenance parts" ON public.maintenance_parts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Auto-decrement stock + auto-draft PO when reorder point hit
CREATE OR REPLACE FUNCTION public.consume_stock_on_maintenance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item RECORD;
  new_qty NUMERIC;
  existing_po UUID;
  new_po_id UUID;
BEGIN
  IF NEW.stock_item_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO item FROM public.stock_items WHERE id = NEW.stock_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  new_qty := item.qty_on_hand - NEW.qty;
  UPDATE public.stock_items SET qty_on_hand = new_qty WHERE id = item.id;

  -- If below reorder point, ensure a draft PO exists for this item
  IF new_qty <= item.reorder_point AND item.reorder_qty > 0 THEN
    SELECT po.id INTO existing_po
      FROM public.purchase_orders po
      JOIN public.po_lines pl ON pl.po_id = po.id
      WHERE po.status = 'draft'
        AND po.supplier_id IS NOT DISTINCT FROM item.supplier_id
        AND pl.stock_item_id = item.id
      LIMIT 1;

    IF existing_po IS NULL THEN
      -- reuse an open draft for this supplier if one exists
      SELECT id INTO existing_po FROM public.purchase_orders
       WHERE status = 'draft' AND supplier_id IS NOT DISTINCT FROM item.supplier_id
       ORDER BY created_at DESC LIMIT 1;

      IF existing_po IS NULL THEN
        INSERT INTO public.purchase_orders (supplier_id, status, notes)
        VALUES (item.supplier_id, 'draft', 'Auto-generated: stock below reorder point')
        RETURNING id INTO new_po_id;
        existing_po := new_po_id;
      END IF;

      INSERT INTO public.po_lines (po_id, stock_item_id, qty, unit_cost)
      VALUES (existing_po, item.id, item.reorder_qty, item.unit_cost);

      UPDATE public.purchase_orders
        SET total_cost = COALESCE((SELECT SUM(qty * unit_cost) FROM public.po_lines WHERE po_id = existing_po), 0)
        WHERE id = existing_po;
    END IF;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_consume_stock
AFTER INSERT ON public.maintenance_parts
FOR EACH ROW EXECUTE FUNCTION public.consume_stock_on_maintenance();

-- When PO received: increment stock
CREATE OR REPLACE FUNCTION public.receive_po()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'received' AND (OLD.status IS DISTINCT FROM 'received') THEN
    UPDATE public.stock_items s
      SET qty_on_hand = s.qty_on_hand + pl.qty
    FROM public.po_lines pl
    WHERE pl.po_id = NEW.id AND pl.stock_item_id = s.id;
    NEW.received_at := now();
  END IF;
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.approved_at := now();
  END IF;
  IF NEW.status = 'ordered' AND OLD.status IS DISTINCT FROM 'ordered' THEN
    NEW.ordered_at := now();
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_receive_po
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.receive_po();

-- ---------- Production ----------
CREATE TABLE public.production_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mine_id UUID NOT NULL REFERENCES public.mines(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  tons_produced NUMERIC(14,2) NOT NULL DEFAULT 0,
  magnetite_used NUMERIC(14,2) NOT NULL DEFAULT 0,
  magnetite_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  overtime_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_logs TO authenticated;
GRANT ALL ON public.production_logs TO service_role;
ALTER TABLE public.production_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage production" ON public.production_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_prod_updated BEFORE UPDATE ON public.production_logs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Static costs ----------
CREATE TABLE public.static_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mine_id UUID REFERENCES public.mines(id) ON DELETE SET NULL,
  month DATE NOT NULL,  -- first day of month
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.static_costs TO authenticated;
GRANT ALL ON public.static_costs TO service_role;
ALTER TABLE public.static_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed manage static costs" ON public.static_costs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_static_updated BEFORE UPDATE ON public.static_costs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
