// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { installBrowserShims, renderScreen } from "./helpers";

// T20: one whole capture form completed using only the keyboard. No clicks: Tab moves between
// fields, Enter opens the mine list, the arrow keys choose, Enter picks, digits are typed, and
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
vi.mock("@/lib/reef-db", () => ({
  useList: () => ({
    data: [
      { id: "m1", name: "Highveld North Pit" },
      { id: "m2", name: "Ogies Pit" },
    ],
    isLoading: false,
  }),
  NUM: (n: number) => String(n),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/hooks/useCaptureLimit", () => ({
  useCaptureLimit: () => ({ days: 60, today: "2026-10-02", earliest: "2026-08-03" }),
}));

beforeAll(() => installBrowserShims());
afterEach(() => cleanup());

describe("T20: a capture form completed with the keyboard alone", () => {
  it("logs production: Tab, choose the mine with the arrow keys, type the tons, Enter on Save", async () => {
    const mod = await import("@/routes/worker/log-production.tsx");
    const { user } = await renderScreen(mod.Route.options.component as never);
    await screen.findByRole("combobox", { name: "Mine" });

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Mine" }));
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Mine" }).textContent).toMatch(/Pit/),
    );

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
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Save/ }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].to).toBe("/api/v1/production-logs");
    expect(sent[0].body).toMatchObject({ tons_produced: 240 });
    expect(["m1", "m2"]).toContain(sent[0].body.mine_id);
  });
});
