// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installBrowserShims, pick, renderScreen } from "./helpers";

// T14A: the stock screens honour the plant split. The network is faked at the API client, so
// the screens are given exactly what the API would return for the signed-in person and the
// tests check what they do with it. The API (T14) decides which plants a person sees.

type Item = {
  id: string;
  name: string;
  plant: string;
  unit: string;
  unit_cost: number;
  sku: null;
  supplier_id: null;
  version: number;
};
type Level = {
  id: string;
  stock_item_id: string;
  plant: string;
  qty_on_hand: number;
  reorder_point: number;
  reorder_qty: number;
  version: number;
};

const item = (id: string, name: string, plant: string): Item => ({
  id,
  name,
  plant,
  unit: "unit",
  unit_cost: 100,
  sku: null,
  supplier_id: null,
  version: 1,
});
const level = (itemId: string, plant: string, qty: number, reorderPoint = 2): Level => ({
  id: `level-${itemId}`,
  stock_item_id: itemId,
  plant,
  qty_on_hand: qty,
  reorder_point: reorderPoint,
  reorder_qty: 5,
  version: 1,
});

// What the API returns this time, set per test.
let me: { id: string; role: string; plant: string | null };
let items: Item[] = [];
let levels: Level[] = [];
const sent: { to: string; method: string; body?: Record<string, unknown> }[] = [];

vi.mock("@/lib/api", () => {
  class ApiRequestError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    ApiRequestError,
    fetchMe: async () => me,
    apiListAll: async (path: string) =>
      path === "/api/v1/stock" ? items : path === "/api/v1/stock-levels" ? levels : [],
    api: async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      sent.push({ to: path, method, body: init?.body ? JSON.parse(init.body) : undefined });
      const one = path.match(/^\/api\/v1\/stock\/([^/?]+)$/);
      if (method === "GET" && one) {
        const found = items.find((i) => i.id === one[1]);
        if (!found)
          throw new ApiRequestError(
            "NOT_FOUND",
            "That stock item does not exist or has been removed",
            404,
          );
        return { data: found };
      }
      if (method === "POST" && path === "/api/v1/stock")
        return { data: { id: "new-item", plant: me.plant ?? "Kriel" } };
      return { data: { id: "saved" } };
    },
  };
});
vi.mock("@/integrations/supabase/client", () => {
  const query = () => ({ select: () => query(), order: async () => ({ data: [], error: null }) });
  return { supabase: { from: () => query() } };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const KRIEL_MANAGER = { id: "manager-1", role: "manager", plant: "Kriel" };
const OWNER = { id: "owner-1", role: "owner", plant: null };

async function inventory(url = "/") {
  const mod = await import("@/routes/_authenticated/inventory.tsx");
  return renderScreen(mod.Route.options.component, url);
}
const columnHeaders = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());

beforeAll(() => installBrowserShims());
beforeEach(() => {
  sent.length = 0;
  items = [item("i1", "Bearing 6205", "Kriel"), item("i2", "V-belt", "Kriel")];
  levels = [level("i1", "Kriel", 10), level("i2", "Kriel", 1)];
});
afterEach(() => cleanup());

describe("T14A: a site manager sees their plant's stock and no plant switch", () => {
  beforeEach(() => {
    me = KRIEL_MANAGER;
  });

  it("shows exactly the rows the API returns, with each plant's own quantity", async () => {
    await inventory();
    const bearing = (await screen.findByText("Bearing 6205")).closest("tr")!;
    expect(within(bearing).getByText(/^10 unit$/)).toBeTruthy();
    const belt = screen.getByText("V-belt").closest("tr")!;
    // At or below its plant's reorder point, so it is marked low.
    expect(within(belt).getByText("Low")).toBeTruthy();
  });

  it("filters nothing itself: a row from another plant, if the API sent one, would still show", async () => {
    // The API would never send this to a Kriel manager. If the screen hid it, the screen would be
    // making the plant rule, and a screen that forgets to would leak. So the screen must show it.
    items = [...items, item("i3", "Ogies chain", "Ogies")];
    levels = [...levels, level("i3", "Ogies", 4)];
    await inventory();
    expect(await screen.findByText("Ogies chain")).toBeTruthy();
  });

  it("offers no plant column, no plant filter, and no plant field when adding", async () => {
    const { user } = await inventory();
    await screen.findByText("Bearing 6205");
    expect(columnHeaders()).not.toContain("Plant");
    expect(screen.queryByRole("combobox", { name: "Plant" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /New stock item/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Plant")).toBeNull();
  });

  it("adds an item without choosing a plant; the API sets it from their profile", async () => {
    const { user } = await inventory();
    await user.click(await screen.findByRole("button", { name: /New stock item/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
      target: { value: "Grease" },
    });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Qty on hand" }), {
      target: { value: "6" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent.filter((s) => s.method === "POST")).toHaveLength(2));
    const [created, firstLevel] = sent.filter((s) => s.method === "POST");
    expect(created).toMatchObject({
      to: "/api/v1/stock",
      body: { name: "Grease", plant: "Kriel" },
    });
    expect(firstLevel).toMatchObject({
      to: "/api/v1/stock-levels",
      body: { stock_item_id: "new-item", plant: "Kriel", qty_on_hand: 6 },
    });
  });

  it("the stock usage picker shows only what the API returns, with no plant choice", async () => {
    const mod = await import("@/routes/worker/log-usage.tsx");
    const { user } = await renderScreen(mod.Route.options.component);
    // One dropdown, the item. No plant dropdown.
    expect(await screen.findAllByRole("combobox")).toHaveLength(1);
    await user.click(screen.getByRole("combobox"));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Bearing 6205 · 10 unit", "V-belt · 1 unit"]);
  });
});

describe("T14A: the owner sees a plant column and can filter by it", () => {
  beforeEach(() => {
    me = OWNER;
    items = [...items, item("i3", "Ogies chain", "Ogies")];
    levels = [...levels, level("i3", "Ogies", 4)];
  });

  it("shows every plant's stock with a Plant column", async () => {
    await inventory();
    await screen.findByText("Ogies chain");
    expect(columnHeaders()).toContain("Plant");
    expect(within(screen.getByText("Ogies chain").closest("tr")!).getByText("Ogies")).toBeTruthy();
  });

  it("narrows the list to one plant", async () => {
    const { user } = await inventory();
    await screen.findByText("Ogies chain");
    await pick(user, screen.getByRole("combobox", { name: "Plant" }), "Ogies");
    expect(screen.getByText("Ogies chain")).toBeTruthy();
    expect(screen.queryByText("Bearing 6205")).toBeNull();
  });

  it("names the plant when adding an item", async () => {
    const { user } = await inventory();
    await user.click(await screen.findByRole("button", { name: /New stock item/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Plant")).toBeTruthy();
  });
});

describe("T14A: another plant's item is 'not found', not an error", () => {
  it("shows a plain message when the API answers 404 for a linked item", async () => {
    me = KRIEL_MANAGER;
    await inventory("/?item=ogies-only-item");
    expect(
      await screen.findByText("That stock item doesn't exist, or it isn't at your plant."),
    ).toBeTruthy();
    // The rest of the screen still works.
    expect(await screen.findByText("Bearing 6205")).toBeTruthy();
    expect(sent.some((s) => s.to === "/api/v1/stock/ogies-only-item")).toBe(true);
  });

  it("shows no message for an item the API does return", async () => {
    me = KRIEL_MANAGER;
    await inventory("/?item=i1");
    await screen.findByText("Bearing 6205");
    await waitFor(() => expect(sent.some((s) => s.to === "/api/v1/stock/i1")).toBe(true));
    expect(screen.queryByText(/isn't at your plant/)).toBeNull();
  });
});

describe("T14A: no plant rule is decided on the screen", () => {
  it("no screen compares a row's plant with the signed-in person's plant", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".gen.ts")) files.push(path);
      }
    };
    walk(join(__dirname, "../src"));
    // A comparison against me.plant, user.plant or profile.plant would be the screen deciding
    // who may see what. That belongs to the API.
    const rule =
      /(me|user|profile)(\.data)?\??\.plant\s*[!=]==|[!=]==\s*(me|user|profile)(\.data)?\??\.plant/;
    const offenders = files.filter((f) => rule.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
