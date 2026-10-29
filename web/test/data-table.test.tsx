// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, type Column } from "@/components/DataTable";

type Row = { id: string; date: string; mine_id: string; tons_produced: number | null };

const MINES: Record<string, string> = { m1: "Kriel", m2: "Ogies", m3: "Witbank" };

// 60 entries: dates 2026-08-01 onwards, mines in rotation, tons 10, 20, 30 … with one blank.
const ROWS: Row[] = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i + 1}`,
  date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
  mine_id: ["m1", "m2", "m3"][i % 3],
  tons_produced: i === 7 ? null : (i + 1) * 10,
}));

const COLUMNS: Column<Row>[] = [
  { key: "date", label: "Date", sortable: true },
  { key: "mine", label: "Mine", sortable: true, value: (r) => MINES[r.mine_id], render: (r) => MINES[r.mine_id] },
  { key: "tons_produced", label: "Tons", sortable: true, value: (r) => r.tons_produced },
];

function setup(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  const user = userEvent.setup();
  render(<DataTable rows={ROWS} columns={COLUMNS} searchable searchLabel="Search production" pageSize={25} {...props} />);
  return { user };
}

/** The visible rows' cells for one column, in order. */
function column(index: number) {
  const body = screen.getAllByRole("rowgroup")[1];
  return within(body).getAllByRole("row").map((r) => within(r).getAllByRole("cell")[index].textContent);
}

afterEach(() => cleanup());

describe("T18: the production table pages", () => {
  it("shows 25 rows at a time and says where you are", () => {
    setup();
    expect(column(0)).toHaveLength(25);
    expect(screen.getByText("Showing 1–25 of 60")).toBeTruthy();
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("moves forward and back, and the last page holds the remainder", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 51–60 of 60")).toBeTruthy();
    expect(column(0)).toHaveLength(10);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  });
});

describe("T18: the production table sorts", () => {
  it("sorts numbers as numbers, ascending then descending, and says so to a screen reader", async () => {
    const { user } = setup();
    const heading = screen.getByRole("columnheader", { name: /Tons/ });
    await user.click(within(heading).getByRole("button"));
    expect(heading.getAttribute("aria-sort")).toBe("ascending");
    expect(column(2).slice(0, 3)).toEqual(["10", "20", "30"]);

    await user.click(within(heading).getByRole("button"));
    expect(heading.getAttribute("aria-sort")).toBe("descending");
    expect(column(2).slice(0, 2)).toEqual(["600", "590"]);
  });

  it("puts a blank value last whichever way the column is sorted", async () => {
    const { user } = setup({ pageSize: 100 });
    const sortTons = () => user.click(within(screen.getByRole("columnheader", { name: /Tons/ })).getByRole("button"));
    await sortTons();
    expect(column(2).at(-1)).toBe("—");
    await sortTons();
    expect(column(2).at(-1)).toBe("—");
  });

  it("sorts by what the cell shows (the site's name), not the hidden id", async () => {
    const { user } = setup({ pageSize: 100 });
    await user.click(within(screen.getByRole("columnheader", { name: /Mine/ })).getByRole("button"));
    const mines = column(1);
    expect(mines[0]).toBe("Kriel");
    expect(mines.at(-1)).toBe("Witbank");
    expect([...mines]).toEqual([...mines].sort());
  });

  it("goes back to the first page when the sort changes", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(within(screen.getByRole("columnheader", { name: /Date/ })).getByRole("button"));
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
  });
});

describe("T18: the production table filters", () => {
  it("keeps only rows matching the search, across what the columns show", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("searchbox", { name: "Search production" }), "ogies");
    expect(screen.getByText("Showing 1–20 of 20")).toBeTruthy();
    expect(new Set(column(1))).toEqual(new Set(["Ogies"]));
  });

  it("works together with paging and sorting", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByRole("searchbox"), "kriel");
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    await user.click(within(screen.getByRole("columnheader", { name: /Tons/ })).getByRole("button"));
    expect(column(2).slice(0, 2)).toEqual(["10", "40"]);
  });

  it("says plainly when nothing matches, rather than showing an empty table", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("searchbox"), "secunda");
    expect(screen.getByText("No records match “secunda”.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });
});
