// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installBrowserShims, renderScreen } from "./helpers";

// The managers' edit dialogs, with the real data layer (reef-db) and only the network faked.
// Tables behind the API are faked at `api`; the rest at the Supabase client.
type Sent = { to: string; method: string; body?: Record<string, unknown> };
const sent: Sent[] = [];
const upserted: { table: string; row: Record<string, unknown> }[] = [];

const MINE = { id: "22222222-0000-0000-0000-000000000001", name: "Highveld North Pit", version: 3 };
const PRODUCTION = {
  id: "44444444-0000-0000-0000-000000000001",
  mine_id: MINE.id,
  date: "2026-09-30",
  shift: "morning",
  tons_produced: 300,
  version: 2,
};
const FUEL = {
  id: "55555555-0000-0000-0000-000000000001",
  date: "2026-09-30",
  litres: 40,
  cost_per_litre: 22,
  fuel_type: "diesel",
  version: 1,
};

const API_ROWS: Record<string, unknown[]> = {
  "/api/v1/mines": [MINE],
  "/api/v1/production-logs": [PRODUCTION],
  "/api/v1/fuel-slips": [FUEL],
};
const SUPABASE_ROWS: Record<string, unknown[]> = {
  clients: [{ id: "c1", name: "Seriti", active: true }],
  equipment: [{ id: "e1", name: "Conveyor CV-201" }],
  stock_items: [{ id: "s1", name: "Bearing 6205", qty_on_hand: 10 }],
  static_costs: [{ id: "sc1", month: "2026-09-01", category: "rent", amount: 1000 }],
  suppliers: [{ id: "sp1", name: "Bearings SA" }],
  employees: [{ id: "w1", full_name: "Sipho Dlamini", shift: "morning", active: true }],
};

vi.mock("@/lib/api", () => ({
  api: async (path: string, init?: { method?: string; body?: string }) => {
    sent.push({
      to: path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return { data: { id: "saved" } };
  },
  apiListAll: async (path: string) => API_ROWS[path] ?? [],
  fetchMe: async () => ({ id: "manager-1", role: "manager" }),
  ApiRequestError: class extends Error {},
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => ({
    select: () => query(table),
    order: async () => ({ data: SUPABASE_ROWS[table] ?? [], error: null }),
    upsert: (row: Record<string, unknown>) => {
      upserted.push({ table, row });
      return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
    },
  });
  return { supabase: { from: (table: string) => query(table) } };
});

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/hooks/useCaptureLimit", () => ({
  useCaptureLimit: () => ({ days: 60, today: "2026-10-02", earliest: "2026-08-03" }),
}));

async function pageOf(file: string) {
  // Vite only resolves a variable import one folder deep, so the employees screen is named outright.
  const mod =
    file === "employees/index"
      ? await import("@/routes/_authenticated/employees/index.tsx")
      : await import(`@/routes/_authenticated/${file}.tsx`);
  return mod.Route.options.component;
}

async function openEdit(file: string) {
  const view = await renderScreen(await pageOf(file));
  await view.user.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
  return { ...view, dialog: await screen.findByRole("dialog") };
}

const patches = () => sent.filter((s) => s.method === "PATCH");

beforeAll(() => installBrowserShims());
beforeEach(() => {
  sent.length = 0;
  upserted.length = 0;
});
afterEach(() => cleanup());

describe("T7: every change screen asks for a reason", () => {
  it.each([
    "clients",
    "equipment",
    "fuel",
    "inventory",
    "mines",
    "production",
    "static-costs",
    "suppliers",
    "employees/index",
  ])("%s: editing shows the reason box", async (file) => {
    const { dialog } = await openEdit(file);
    expect(within(dialog).getByRole("textbox", { name: "Reason for this change" })).toBeTruthy();
  });

  it("adding a new record does not ask for one", async () => {
    const { user } = await renderScreen(await pageOf("mines"));
    await user.click(await screen.findByRole("button", { name: /New mine/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("textbox", { name: "Reason for this change" })).toBeNull();
  });
});

describe("T7: a change will not save without a reason", () => {
  it("an empty reason sends nothing, says why, and moves focus to the box", async () => {
    const { dialog } = await openEdit("production");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));

    expect(
      await within(dialog).findByText("A reason is required when changing a record"),
    ).toBeTruthy();
    const box = within(dialog).getByRole("textbox", { name: "Reason for this change" });
    expect(box.getAttribute("aria-invalid")).toBe("true");
    // A screen reader reads the problem out with the box.
    const message = within(dialog).getByText("A reason is required when changing a record");
    expect(box.getAttribute("aria-describedby")).toContain(message.id);
    expect(document.activeElement).toBe(box);
    expect(patches()).toHaveLength(0);
  });

  it("only spaces is not a reason", async () => {
    const { dialog } = await openEdit("production");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for this change" }), {
      target: { value: "   " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
    expect(
      await within(dialog).findByText("A reason is required when changing a record"),
    ).toBeTruthy();
    expect(patches()).toHaveLength(0);
  });

  it("a reason over 500 characters is refused before it is sent", async () => {
    const { dialog } = await openEdit("production");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for this change" }), {
      target: { value: "x".repeat(501) },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
    expect(
      await within(dialog).findByText("The reason is too long (500 characters maximum)"),
    ).toBeTruthy();
    expect(patches()).toHaveLength(0);
  });

  it("with a reason, the update carries it with the version", async () => {
    const { dialog } = await openEdit("production");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for this change" }), {
      target: { value: "  Tons were captured wrong on the slip " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].to).toBe(`/api/v1/production-logs/${PRODUCTION.id}`);
    expect(patches()[0].body).toMatchObject({
      version: 2,
      reason: "Tons were captured wrong on the slip",
    });
    expect(patches()[0].body).not.toHaveProperty("changeReason");
  });

  it("the box starts empty each time the dialog opens", async () => {
    const { user, dialog } = await openEdit("mines");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for this change" }), {
      target: { value: "Old reason" },
    });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const again = await screen.findByRole("dialog");
    expect(
      (
        within(again).getByRole("textbox", {
          name: "Reason for this change",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("");
  });

  it("a new record is saved without a reason, as before", async () => {
    const { user } = await renderScreen(await pageOf("mines"));
    await user.click(await screen.findByRole("button", { name: /New mine/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector('input[name="name"]')!, {
      target: { value: "Ogies Pit" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(sent.filter((s) => s.method === "POST")).toHaveLength(1));
    expect(sent.find((s) => s.method === "POST")!.body).not.toHaveProperty("reason");
  });

  it("a table not yet behind the API still asks, but never writes the reason into the record", async () => {
    const { dialog } = await openEdit("clients");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
    expect(
      await within(dialog).findByText("A reason is required when changing a record"),
    ).toBeTruthy();
    expect(upserted).toHaveLength(0);

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for this change" }), {
      target: { value: "New contact" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(upserted).toHaveLength(1));
    expect(upserted[0].row).not.toHaveProperty("changeReason");
    expect(upserted[0].row).not.toHaveProperty("reason");
  });
});
