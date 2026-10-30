// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { installBrowserShims, renderScreen } from "./helpers";

// T20: one whole capture form completed using only the keyboard. No clicks: Tab moves between
// editable fields, digits and notes are typed, and
// Enter on the Save button sends it. The manual recording is the evidence for the sheet; this
// test keeps it from quietly breaking.

const sent: { to: string; body: Record<string, unknown> }[] = [];

vi.mock("@/lib/api", () => ({
  api: async (path: string, init?: { body?: string }) => {
    sent.push({ to: path, body: init?.body ? JSON.parse(init.body) : {} });
    return { data: { id: "saved" } };
  },
  apiListAll: async () => [],
  fetchMe: async () => ({ id: "worker-1", role: "worker" }),
  ApiRequestError: class extends Error {},
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "worker-1" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === "profiles"
                ? { employee_id: "employee-1" }
                : { mine: { id: "m1", name: "Highveld North Pit" } },
            error: null,
          }),
        }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/hooks/useCaptureLimit", () => ({
  useCaptureLimit: () => ({ days: 60, today: "2026-10-02", earliest: "2026-08-03" }),
}));

beforeAll(() => installBrowserShims());
afterEach(() => {
  cleanup();
  sent.length = 0;
});

describe("T20: a capture form completed with the keyboard alone", () => {
  it("logs production for the assigned mine: Tab, type tons and notes, Enter on Save", async () => {
    const mod = await import("@/routes/worker/log-production.tsx");
    const { user } = await renderScreen(mod.Route.options.component as never);
    await screen.findByText("Highveld North Pit");
    expect(screen.queryByRole("combobox", { name: "Mine" })).toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("spinbutton", { name: "Tons produced" }));
    await user.keyboard("240");
    // Under a busy test run the screen can lag the keys; wait until it shows all three digits.
    await waitFor(() =>
      expect(
        (screen.getByRole("spinbutton", { name: "Tons produced" }) as HTMLInputElement).value,
      ).toBe("240"),
    );

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Notes" }));
    await user.keyboard("Day shift production");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Save/ }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].to).toBe("/api/v1/production-logs");
    expect(sent[0].body).toMatchObject({
      tons_produced: 240,
      mine_id: "m1",
      notes: "Day shift production",
    });
  });
});
