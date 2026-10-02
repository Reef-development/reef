// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { deferred, installBrowserShims, pick, renderScreen } from "./helpers";

// The managers' "Log …" dialogs, with the real data layer (reef-db) and only the network
// faked. Each save is held in flight until the test lets it finish.
const sent: { to: string; method: string }[] = [];
let inFlight: ReturnType<typeof deferred>[] = [];

const MINE = { id: "22222222-0000-0000-0000-000000000001", name: "Highveld North Pit" };
const EQUIPMENT = { id: "33333333-0000-0000-0000-000000000001", name: "Conveyor CV-201" };

vi.mock("@/lib/api", () => ({
  api: (path: string, init?: { method?: string }) => {
    sent.push({ to: path, method: init?.method ?? "GET" });
    const d = deferred();
    inFlight.push(d);
    return d.promise.then(() => ({ data: { id: "new" } }));
  },
  apiListAll: async (path: string) => (path.includes("/mines") ? [MINE] : []),
  fetchMe: async () => ({ id: "manager-1", role: "manager" }),
  ApiRequestError: class extends Error {},
}));

// Tables not yet behind the API are still read straight from Supabase.
vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, unknown[]> = { equipment: [EQUIPMENT] };
  const query = (table: string) => ({
    select: () => query(table),
    order: async () => ({ data: rows[table] ?? [], error: null }),
  });
  return { supabase: { from: (table: string) => query(table) } };
});

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/hooks/useCaptureLimit", () => ({
  useCaptureLimit: () => ({ days: 60, today: "2026-10-02", earliest: "2026-08-03" }),
}));

async function pageOf(file: string) {
  const mod = await import(`@/routes/_authenticated/${file}.tsx`);
  return mod.Route.options.component;
}

beforeAll(() => installBrowserShims());
beforeEach(() => {
  sent.length = 0;
  inFlight = [];
});
afterEach(() => cleanup());

async function doubleTapSave(dialog: HTMLElement) {
  const save = within(dialog).getByRole("button", { name: /^Save/ });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(sent.filter((s) => s.method === "POST").length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 50));
  inFlight.forEach((d) => d.resolve(undefined));
}

describe("T18: the managers' log dialogs also save once per double tap", () => {
  it("Log production", async () => {
    const { user } = await renderScreen(await pageOf("production"));
    await user.click(await screen.findByRole("button", { name: /Log production/ }));
    const dialog = await screen.findByRole("dialog");
    await pick(user, within(dialog).getAllByRole("combobox")[0], MINE.name);
    fireEvent.change(dialog.querySelector('input[name="tons_produced"]')!, { target: { value: "300" } });
    await doubleTapSave(dialog);
    expect(sent.filter((s) => s.to === "/api/v1/production-logs" && s.method === "POST")).toHaveLength(1);
  });

  it("Add fuel slip", async () => {
    const { user } = await renderScreen(await pageOf("fuel"));
    await user.click(await screen.findByRole("button", { name: /Add slip/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector('input[name="vehicle_label"]')!, { target: { value: "LDV 3" } });
    const [litres, price] = within(dialog).getAllByRole("spinbutton");
    fireEvent.change(litres, { target: { value: "40" } });
    fireEvent.change(price, { target: { value: "22" } });
    await doubleTapSave(dialog);
    expect(sent.filter((s) => s.to === "/api/v1/fuel-slips" && s.method === "POST")).toHaveLength(1);
  });

  it("Log repair", async () => {
    const { user } = await renderScreen(await pageOf("maintenance"));
    await user.click(await screen.findByRole("button", { name: /Log repair/ }));
    const dialog = await screen.findByRole("dialog");
    await pick(user, within(dialog).getAllByRole("combobox")[0], EQUIPMENT.name);
    fireEvent.change(dialog.querySelector('input[name="description"]')!, { target: { value: "Replaced belt" } });
    await doubleTapSave(dialog);
    expect(sent.filter((s) => s.to === "/api/v1/maintenance-logs" && s.method === "POST")).toHaveLength(1);
  });
});
