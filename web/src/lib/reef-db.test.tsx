import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// vi.mock factories are hoisted above the rest of the file. Anything they refer to
// must itself be hoisted, or it will not exist when the factory runs. vi.hoisted
// runs its body at the same hoisted time, so the spies below are ready when the
// mocks need them.
const { mockToastSuccess, mockToastError, mockFrom } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mockFrom,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiListAll: vi.fn(),
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { useUpsert, useRemove } from "./reef-db";

/** A component that renders a button calling useUpsert with the given row. */
function UpsertHarness({ row }: { row: Record<string, unknown> }) {
  const upsert = useUpsert("employees");
  return (
    <button
      onClick={() => {
        upsert.mutate(row, {
          onError: () => {
            // React Query requires that the error be observed; the hook's own onError
            // has already run by the time this fires.
          },
        });
      }}
    >
      Save
    </button>
  );
}

/** A component that renders a button calling useRemove with the given id. */
function RemoveHarness({ id }: { id: string }) {
  const remove = useRemove("employees");
  return (
    <button
      onClick={() => {
        remove.mutate(id);
      }}
    >
      Delete
    </button>
  );
}

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("T19: a refused or failed action", () => {
  beforeEach(() => {
    mockToastSuccess.mockClear();
    mockToastError.mockClear();
    mockFrom.mockReset();
  });

  it("shows an error toast, not a blank panel, when the save is refused", async () => {
    mockFrom.mockReturnValue({
      upsert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({ data: null, error: { message: "Refused by the server" } }),
        }),
      }),
    });

    renderWithClient(<UpsertHarness row={{ full_name: "Test" }} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await vi.waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(mockToastError.mock.calls[0][0]).toBe("Refused by the server");
  });

  it("shows an error toast when the delete is refused", async () => {
    mockFrom.mockReturnValue({
      delete: () => ({
        eq: () => Promise.resolve({ error: { message: "Refused by the server" } }),
      }),
    });

    renderWithClient(<RemoveHarness id="emp-1" />);
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));

    await vi.waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(mockToastError.mock.calls[0][0]).toBe("Refused by the server");
  });
});

describe("T19: the list refreshes without a page load", () => {
  beforeEach(() => {
    mockToastSuccess.mockClear();
    mockToastError.mockClear();
    mockFrom.mockReset();
  });

  it("invalidates the table's queries after a successful remove", async () => {
    // A real QueryClient, but with invalidateQueries spied on, so we can assert on
    // what the hook called without needing to observe a refetch.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries").mockImplementation(() => Promise.resolve());

    mockFrom.mockReturnValue({
      delete: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    });

    render(
      <QueryClientProvider client={client}>
        <RemoveHarness id="emp-1" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));

    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalled();
    });
    expect(invalidateSpy.mock.calls[0][0]).toEqual({ queryKey: ["employees"] });
  });
});