// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import axe from "axe-core";
import { installBrowserShims, renderScreen } from "./helpers";

// Every manager form, opened and run through axe-core, the accessibility checker. The checker
// found that the shared Field label was not tied to its input, so a screen reader announced an
// unnamed box. These tests fail if that comes back on any form.
vi.mock("@/lib/api", () => ({
  api: async () => ({ data: { id: "saved" } }),
  apiListAll: async () => [],
  fetchMe: async () => ({ id: "manager-1", role: "manager" }),
  ApiRequestError: class extends Error {},
}));
vi.mock("@/integrations/supabase/client", () => {
  const query = () => ({ select: () => query(), order: async () => ({ data: [], error: null }) });
  return { supabase: { from: () => query() } };
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

/** Colour contrast needs a real browser, so it is left to the manual check. */
async function problems(root: Element) {
  const { violations } = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

beforeAll(() => installBrowserShims());
afterEach(() => cleanup());

describe("T18: every field on the manager forms is labelled for a screen reader", () => {
  it.each([
    ["clients", /New client/],
    ["equipment", /New equipment|Add/],
    ["fuel", /Add slip/],
    ["inventory", /New stock item/],
    ["maintenance", /Log repair/],
    ["mines", /New mine/],
    ["production", /Log production/],
    ["static-costs", /New cost|Add/],
    ["suppliers", /New supplier|Add/],
    ["employees/index", /New worker|Add/],
  ])("%s", async (file, button) => {
    const { user } = await renderScreen(await pageOf(file));
    await user.click((await screen.findAllByRole("button", { name: button }))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(await problems(dialog)).toEqual([]);
  });
});
