// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { installBrowserShims, renderScreen } from "./helpers";

// The manager's attendance screen reads straight from Supabase, so the client is faked here:
// one mine, two people on its roster, and a record of every upsert the screen sends.
const MINE = { id: "mine-1", name: "Highveld North Pit" };
const ROSTER = [
  { id: "emp-1", full_name: "Thandi Mokoena", position: "Fitter" },
  { id: "emp-2", full_name: "Sipho Dlamini", position: null },
];
const upserts = vi.hoisted(() => [] as { rows: Record<string, unknown>[]; opts: unknown }[]);

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      maybeSingle: async () => {
        if (table === "profiles") return { data: { employee_id: "manager-emp" }, error: null };
        if (table === "employees") return { data: { mine: MINE }, error: null };
        return { data: null, error: null };
      },
      upsert: async (rows: Record<string, unknown>[], opts: unknown) => {
        upserts.push({ rows, opts });
        return { error: null };
      },
      then: (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve({ data: table === "employees" ? ROSTER : [], error: null }).then(ok, bad),
    };
    return b;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: builder,
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

async function openScreen() {
  const mod = await import("@/routes/manager/log-attendance");
  const view = await renderScreen(mod.Route.options.component as never);
  await screen.findByText("Thandi Mokoena");
  return view;
}

const statusGroup = (name: string) => screen.getByRole("group", { name: `Status for ${name}` });

beforeAll(() => installBrowserShims());
beforeEach(() => {
  upserts.length = 0;
});
afterEach(() => cleanup());

describe("the manager's attendance screen", () => {
  it("lists the roster with everybody present and a running count", async () => {
    await openScreen();
    expect(screen.getByText("Sipho Dlamini")).toBeTruthy();
    expect(screen.getByText("Fitter")).toBeTruthy();
    expect(screen.getByText("2 present · 0 absent · 0 leave · 0 sick")).toBeTruthy();
  });

  it("saves someone who was absent with no hours, and names the shift in the upsert", async () => {
    const { user } = await openScreen();
    await user.click(within(statusGroup("Thandi Mokoena")).getByRole("button", { name: "Absent" }));
    expect(screen.getByText("1 present · 1 absent · 0 leave · 0 sick")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save attendance" }));
    await waitFor(() => expect(upserts).toHaveLength(1));

    const { rows, opts } = upserts[0]!;
    expect(opts).toEqual({ onConflict: "employee_id,date,shift" });
    expect(rows.find((r) => r.employee_id === "emp-1")).toMatchObject({
      status: "absent",
      hours_worked: 0,
      shift: "morning",
    });
    expect(rows.find((r) => r.employee_id === "emp-2")).toMatchObject({
      status: "present",
      hours_worked: 8,
    });
  });

  it("steps the hours up and down in half hours", async () => {
    const { user } = await openScreen();
    const hours = screen.getByLabelText("Hours worked by Sipho Dlamini") as HTMLInputElement;
    expect(hours.value).toBe("8");
    await user.click(screen.getByRole("button", { name: "More hours for Sipho Dlamini" }));
    await user.click(screen.getByRole("button", { name: "More hours for Sipho Dlamini" }));
    expect(hours.value).toBe("9");
    await user.click(screen.getByRole("button", { name: "Fewer hours for Sipho Dlamini" }));
    expect(hours.value).toBe("8.5");
  });

  it("keeps a note with the person it was written for", async () => {
    const { user } = await openScreen();
    await user.click(within(statusGroup("Sipho Dlamini")).getByRole("button", { name: "Sick" }));
    await user.click(screen.getAllByRole("button", { name: /Add note/ })[1]!);
    await user.type(screen.getByLabelText("Note for Sipho Dlamini"), "Clinic letter");
    await user.click(screen.getByRole("button", { name: "Save attendance" }));
    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0]!.rows.find((r) => r.employee_id === "emp-2")).toMatchObject({
      status: "sick",
      hours_worked: 0,
      notes: "Clinic letter",
    });
  });

  it("filters by status and by search", async () => {
    const { user } = await openScreen();
    await user.click(within(statusGroup("Thandi Mokoena")).getByRole("button", { name: "Absent" }));

    await user.click(screen.getByRole("button", { name: /^Absent 1/ }));
    expect(screen.getByText("Thandi Mokoena")).toBeTruthy();
    expect(screen.queryByText("Sipho Dlamini")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Absent 1/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search workers" }), "sipho");
    expect(screen.queryByText("Thandi Mokoena")).toBeNull();
    expect(screen.getByText("Sipho Dlamini")).toBeTruthy();
  });

  it("puts everybody back to present in one tap", async () => {
    const { user } = await openScreen();
    await user.click(within(statusGroup("Thandi Mokoena")).getByRole("button", { name: "Leave" }));
    await user.click(within(statusGroup("Sipho Dlamini")).getByRole("button", { name: "Sick" }));
    expect(screen.getByText("0 present · 0 absent · 1 leave · 1 sick")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /All present/ }));
    expect(screen.getByText("2 present · 0 absent · 0 leave · 0 sick")).toBeTruthy();
  });
});
