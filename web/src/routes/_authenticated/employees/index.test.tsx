import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mocks are declared before the imports that use them. Vitest hoists vi.mock above
// the module graph, so the component below sees the mocks, not the real code.

const mockRemoveMutate = vi.fn();

vi.mock("@/lib/reef-db", () => ({
  useList: (table: string) => {
    if (table === "employees") {
      return {
        data: [
          {
            id: "emp-1",
            full_name: "Test Worker One",
            employee_no: "W001",
            position: "Operator",
            mine_id: null,
            shift: "morning",
            team_name: "Alpha",
            hourly_rate: 150,
            active: true,
          },
        ],
        isLoading: false,
      };
    }
    return { data: [], isLoading: false };
  },
  useUpsert: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemove: () => ({ mutate: mockRemoveMutate, isPending: false }),
  NUM: (n: number) => String(n),
  ZAR: (n: number) => `R${n}`,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: unknown }) => opts,
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Import the component after the mocks are set up.
import { Page } from "./index";

function findTrashButtons() {
  return screen
    .getAllByRole("button")
    .filter((b) => b.querySelector("svg")?.classList.contains("lucide-trash2"));
}

describe("T19: the employees register", () => {
  beforeEach(() => {
    mockRemoveMutate.mockClear();
  });

  it("asks for confirmation before it removes a worker", async () => {
    // DataTable uses window.confirm. Return false so we can prove that cancelling
    // means nothing is removed.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<Page />);

    const trashButtons = findTrashButtons();
    expect(trashButtons).toHaveLength(1);

    await userEvent.click(trashButtons[0]);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith("Delete this record?");
    expect(mockRemoveMutate).not.toHaveBeenCalled();
  });

  it("removes the worker when the confirmation is accepted", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Page />);

    const trashButtons = findTrashButtons();
    expect(trashButtons).toHaveLength(1);

    await userEvent.click(trashButtons[0]);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockRemoveMutate).toHaveBeenCalledTimes(1);
    expect(mockRemoveMutate).toHaveBeenCalledWith("emp-1");
  });
});