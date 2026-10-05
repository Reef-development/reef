import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The auth screen talks to Supabase directly and to Lovable's OAuth helper.
// Neither should run in a test. Mock both with no-ops.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock("@/integrations/lovable", () => ({
  lovable: { auth: { signInWithOAuth: vi.fn() } },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: unknown }) => opts,
  useNavigate: () => vi.fn(),
  redirect: vi.fn(),
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AuthPage } from "./auth";

describe("T19: the register screen", () => {
  it("offers exactly the three real roles on the register tab", async () => {
    render(<AuthPage />);

    // The role selector is on the Register tab, not the default Sign in tab.
    const registerTab = screen.getByRole("tab", { name: /register/i });
    await userEvent.click(registerTab);

    // The Select for role is the only combobox on the register tab.
    const triggers = screen.getAllByRole("combobox");
    const roleTrigger = triggers[triggers.length - 1];
    await userEvent.click(roleTrigger);

    const options = await screen.findAllByRole("option");
    const optionText = options.map((o) => o.textContent ?? "");

    // Exactly three, and exactly the three real roles.
    expect(options).toHaveLength(3);
    expect(optionText.some((t) => /worker/i.test(t))).toBe(true);
    expect(optionText.some((t) => /manager/i.test(t))).toBe(true);
    expect(optionText.some((t) => /owner/i.test(t))).toBe(true);
  });

  it("offers no role that should not exist", async () => {
    render(<AuthPage />);

    const registerTab = screen.getByRole("tab", { name: /register/i });
    await userEvent.click(registerTab);

    const triggers = screen.getAllByRole("combobox");
    const roleTrigger = triggers[triggers.length - 1];
    await userEvent.click(roleTrigger);

    const options = await screen.findAllByRole("option");
    // Roles from the database enum that are not real: supervisor and
    // stock_controller came from the first migration and are never assigned.
    const forbidden = ["admin", "supervisor", "stock_controller", "superuser"];
    for (const opt of options) {
      const text = (opt.textContent ?? "").toLowerCase();
      for (const bad of forbidden) {
        expect(text).not.toContain(bad);
      }
    }
  });
});