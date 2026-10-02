// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { deferred, installBrowserShims, pick, renderScreen } from "./helpers";

// Every save is recorded and held "in flight" until the test lets it finish, which is when an
// impatient second tap does its damage.
const sent: { to: string; body: unknown }[] = [];
let inFlight: ReturnType<typeof deferred>[] = [];
const hold = (to: string, body: unknown) => {
  sent.push({ to, body });
  const d = deferred();
  inFlight.push(d);
  return d.promise;
};

vi.mock("@/lib/api", () => ({
  api: (path: string, init?: { body?: string }) =>
    hold(path, init?.body ? JSON.parse(init.body) : undefined).then(() => ({ data: { id: "new" } })),
  apiListAll: async () => [],
  fetchMe: async () => ({ id: "worker-1", role: "worker" }),
  ApiRequestError: class extends Error {},
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "worker-1" } } }) },
    from: (table: string) => ({ insert: (row: unknown) => hold(table, row).then(() => ({ error: null })) }),
  },
}));

vi.mock("@/lib/photo-upload", () => ({ uploadPhotos: async () => [] }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const DATA: Record<string, unknown[]> = {
  mines: [{ id: "22222222-0000-0000-0000-000000000001", name: "Highveld North Pit" }],
  equipment: [{ id: "33333333-0000-0000-0000-000000000001", name: "Conveyor CV-201" }],
  stock_items: [{ id: "44444444-0000-0000-0000-000000000001", name: "Bearing 6205", qty_on_hand: 10, unit: "unit" }],
};
vi.mock("@/lib/reef-db", () => ({
  useList: (table: string) => ({ data: DATA[table] ?? [], isLoading: false }),
  NUM: (n: number) => String(n),
  ZAR: (n: number) => `R ${n}`,
}));

type User = ReturnType<typeof userEvent.setup>;

/**
 * Sets a number field the way the app sees it once a person has finished typing. (Typing key
 * by key into a number field does not work in jsdom, which has no caret for number inputs.)
 */
function setNumber(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

/** Taps Save twice, the second before the screen has had a chance to react to the first. */
function doubleTap(button: HTMLElement) {
  fireEvent.click(button);
  fireEvent.click(button);
}

async function screenOf(path: string) {
  const mod = await import(`@/routes/worker/${path}.tsx`);
  return mod.Route.options.component;
}

const FORMS: { name: string; file: string; fill: (user: User) => Promise<void>; save: string; table: string }[] = [
  {
    name: "production",
    file: "log-production",
    table: "/api/v1/production-logs",
    save: "Save Production",
    fill: async (user) => {
      await pick(user, screen.getByRole("combobox"), "Highveld North Pit");
      setNumber(screen.getByRole("spinbutton"), "300");
    },
  },
  {
    name: "stock usage",
    file: "log-usage",
    table: "/api/v1/stock-usage",
    save: "Save",
    fill: async (user) => {
      await pick(user, screen.getByRole("combobox"), /Bearing 6205/);
      setNumber(screen.getByRole("spinbutton"), "2");
    },
  },
  {
    name: "repair",
    file: "log-repair",
    table: "/api/v1/maintenance-logs",
    save: "Save Repair",
    fill: async (user) => {
      await pick(user, screen.getByRole("combobox"), "Conveyor CV-201");
      await user.type(screen.getByPlaceholderText(/Replaced belt/), "Replaced drive belt");
    },
  },
  {
    name: "fuel",
    file: "log-fuel",
    table: "/api/v1/fuel-slips",
    save: "Save",
    fill: async (user) => {
      await user.type(screen.getByPlaceholderText(/type vehicle/), "LDV 3");
      const [litres, price] = screen.getAllByRole("spinbutton");
      setNumber(litres, "40");
      setNumber(price, "22");
    },
  },
  {
    name: "downtime",
    file: "log-downtime",
    table: "downtime_events",
    save: "Save Downtime",
    fill: async (user) => {
      await pick(user, screen.getAllByRole("combobox")[0], "Highveld North Pit");
    },
  },
];

beforeAll(() => installBrowserShims());
beforeEach(() => {
  sent.length = 0;
  inFlight = [];
});
afterEach(() => cleanup());

describe("T18: a double tap on save creates one record, not two", () => {
  for (const form of FORMS) {
    it(`on the ${form.name} capture form`, async () => {
      const { user } = await renderScreen(await screenOf(form.file));
      await form.fill(user);
      const save = screen.getByRole("button", { name: form.save });

      doubleTap(save);
      await waitFor(() => expect(sent.length).toBeGreaterThan(0));
      // Give a second save every chance to start before letting the first finish.
      await new Promise((r) => setTimeout(r, 50));
      inFlight.forEach((d) => d.resolve(undefined));

      const records = sent.filter((s) => s.to === form.table);
      expect(records, `${form.name}: records sent`).toHaveLength(1);
    });
  }
});
