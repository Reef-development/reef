import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { reefToday } from "@reef/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { toast } from "sonner";
import { CheckCheck, Minus, Plus, Search, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/manager/log-attendance")({ component: Page });

type MyMine = { id: string; name: string } | null;
type RosterEntry = { id: string; full_name: string; position: string | null };
type AttendanceStatus = "present" | "absent" | "leave" | "sick";
type Filter = "all" | AttendanceStatus;

type AttendanceState = {
  status: AttendanceStatus;
  hours_worked: number | "";
  notes: string;
};

const DEFAULT_HOURS = 8;
const MAX_HOURS = 24;

const STATUSES: { value: AttendanceStatus; label: string; on: string; dot: string }[] = [
  {
    value: "present",
    label: "Present",
    on: "border-emerald-600 bg-emerald-600 text-white",
    dot: "bg-emerald-600",
  },
  {
    value: "absent",
    label: "Absent",
    on: "border-red-600 bg-red-600 text-white",
    dot: "bg-red-600",
  },
  {
    value: "leave",
    label: "Leave",
    on: "border-amber-500 bg-amber-500 text-white",
    dot: "bg-amber-500",
  },
  { value: "sick", label: "Sick", on: "border-sky-600 bg-sky-600 text-white", dot: "bg-sky-600" },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const clampHours = (n: number) => Math.min(MAX_HOURS, Math.max(0, n));

function Page() {
  const today = reefToday();
  const prettyDate = new Date(`${today}T12:00:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const [attendanceData, setAttendanceData] = useState<Record<string, AttendanceState>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const qc = useQueryClient();

  // 1. The manager's assigned mine, found the same way the worker forms find theirs.
  const myMine = useQuery<MyMine>({
    queryKey: ["my-mine"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("employee_id")
        .eq("id", uid)
        .maybeSingle();
      if (profileError) throw profileError;

      const employeeId = (profile as { employee_id: string | null } | null)?.employee_id;
      if (!employeeId) return null;

      const { data: employee, error: employeeError } = await supabase
        .from("employees")
        .select("mine_id, mine:mines(id, name)")
        .eq("id", employeeId)
        .maybeSingle();
      if (employeeError) throw employeeError;

      const mine = (employee as { mine?: { id: string; name: string } | null } | null)?.mine;
      return mine ?? null;
    },
  });

  // 2. The active employees on that mine.
  const roster = useQuery<RosterEntry[]>({
    queryKey: ["roster", myMine.data?.id],
    enabled: !!myMine.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, position")
        .eq("mine_id", myMine.data!.id)
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return (data as RosterEntry[]) ?? [];
    },
  });

  // 3. Anything already logged for today.
  const existing = useQuery({
    queryKey: ["attendance", myMine.data?.id, today],
    enabled: !!myMine.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("employee_id, status, hours_worked, notes")
        .eq("mine_id", myMine.data!.id)
        .eq("date", today);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fill the form once the roster and today's records are in.
  useEffect(() => {
    if (!roster.data) return;
    const initial: Record<string, AttendanceState> = {};
    const noteRows: Record<string, boolean> = {};
    roster.data.forEach((emp) => {
      const record = existing.data?.find((e) => e.employee_id === emp.id);
      initial[emp.id] = {
        status: (record?.status as AttendanceStatus) ?? "present",
        hours_worked:
          record?.status && record.status !== "present"
            ? DEFAULT_HOURS
            : (record?.hours_worked ?? DEFAULT_HOURS),
        notes: record?.notes ?? "",
      };
      if (record?.notes) noteRows[emp.id] = true;
    });
    setAttendanceData(initial);
    setOpenNotes(noteRows);
  }, [roster.data, existing.data]);

  const updateRow = (empId: string, updates: Partial<AttendanceState>) => {
    setAttendanceData((prev) => ({
      ...prev,
      [empId]: { ...prev[empId]!, ...updates },
    }));
  };

  const markAllPresent = () =>
    setAttendanceData((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, row]) => [
          id,
          {
            ...row,
            status: "present" as const,
            hours_worked: row.hours_worked === "" ? DEFAULT_HOURS : row.hours_worked,
          },
        ]),
      ),
    );

  const counts = useMemo(() => {
    const c: Record<AttendanceStatus, number> = { present: 0, absent: 0, leave: 0, sick: 0 };
    Object.values(attendanceData).forEach((row) => (c[row.status] += 1));
    return c;
  }, [attendanceData]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (roster.data ?? []).filter((emp) => {
      if (filter !== "all" && attendanceData[emp.id]?.status !== filter) return false;
      if (!q) return true;
      return (
        emp.full_name.toLowerCase().includes(q) || (emp.position ?? "").toLowerCase().includes(q)
      );
    });
  }, [roster.data, attendanceData, query, filter]);

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      if (!myMine.data) throw new Error("No mine assigned");
      const { data: auth } = await supabase.auth.getUser();

      // Hours only count for someone who was present; everybody else is saved with none.
      const rows = Object.entries(attendanceData).map(([empId, data]) => ({
        mine_id: myMine.data!.id,
        employee_id: empId,
        date: today,
        shift: "morning" as const,
        status: data.status,
        hours_worked: data.status === "present" ? clampHours(Number(data.hours_worked) || 0) : 0,
        notes: data.notes.trim() || null,
        logged_by: auth.user?.id ?? null,
      }));

      // The table is unique on employee, date and shift, so the upsert has to name all three.
      const { error } = await supabase
        .from("attendance")
        .upsert(rows, { onConflict: "employee_id,date,shift" });

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      toast.success("Attendance saved");
      navigate({ to: "/worker" });
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error ? e.message : "Attendance could not be saved. Please try again.",
      ),
  });

  if (myMine.isLoading || roster.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading roster">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (myMine.error || roster.error || existing.error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
      >
        <p className="font-medium">The roster could not be loaded.</p>
        <p className="mt-1 text-muted-foreground">Check your connection and try again.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            void myMine.refetch();
            void roster.refetch();
            void existing.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (!myMine.data) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">No mine assigned to you yet.</p>
        <p className="mt-1 text-muted-foreground">
          Ask the owner to assign you to a mine, then come back here.
        </p>
      </div>
    );
  }

  const total = roster.data?.length ?? 0;
  const alreadyLogged = (existing.data?.length ?? 0) > 0;

  return (
    <div className="space-y-4 pb-32">
      <header className="rounded-xl border bg-card p-4">
        <h1 className="text-xl font-bold leading-tight">Log attendance</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {myMine.data.name} · {prettyDate}
        </p>
        {alreadyLogged && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Today's attendance is already saved. Saving again updates it.
          </p>
        )}
      </header>

      {total === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          No active workers found on this mine.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            <button
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === "all"
                  ? "border-foreground bg-foreground text-background"
                  : "bg-card text-muted-foreground",
              )}
            >
              All {total}
            </button>
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={filter === s.value}
                onClick={() => setFilter(filter === s.value ? "all" : s.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === s.value
                    ? "border-foreground bg-foreground text-background"
                    : "bg-card text-muted-foreground",
                )}
              >
                <span className={cn("size-2 rounded-full", s.dot)} aria-hidden="true" />
                {s.label} {counts[s.value]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search workers"
                placeholder="Search by name or position"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 pl-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0"
              onClick={markAllPresent}
            >
              <CheckCheck className="mr-1.5 size-4" aria-hidden="true" />
              All present
            </Button>
          </div>

          <ul className="space-y-3">
            {visible.length === 0 && (
              <li className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">
                Nobody matches that. Clear the search or the filter.
              </li>
            )}
            {visible.map((emp) => {
              const row = attendanceData[emp.id];
              if (!row) return null;
              const isPresent = row.status === "present";
              const hours = row.hours_worked === "" ? 0 : Number(row.hours_worked);
              return (
                <li key={emp.id} className="space-y-3 rounded-xl border bg-card p-3.5">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                      aria-hidden="true"
                    >
                      {initials(emp.full_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-tight">{emp.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {emp.position || "Worker"}
                      </p>
                    </div>
                  </div>

                  <div
                    className="grid grid-cols-4 gap-1.5"
                    role="group"
                    aria-label={`Status for ${emp.full_name}`}
                  >
                    {STATUSES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        aria-pressed={row.status === s.value}
                        onClick={() => updateRow(emp.id, { status: s.value })}
                        className={cn(
                          "h-11 rounded-lg border text-xs font-medium transition-colors",
                          row.status === s.value
                            ? s.on
                            : "bg-background text-foreground hover:bg-muted",
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    {isPresent ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-10"
                          aria-label={`Fewer hours for ${emp.full_name}`}
                          onClick={() =>
                            updateRow(emp.id, { hours_worked: clampHours(hours - 0.5) })
                          }
                          disabled={hours <= 0}
                        >
                          <Minus className="size-4" aria-hidden="true" />
                        </Button>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          min={0}
                          max={MAX_HOURS}
                          aria-label={`Hours worked by ${emp.full_name}`}
                          className="h-10 w-16 text-center"
                          value={row.hours_worked}
                          onChange={(e) =>
                            updateRow(emp.id, {
                              hours_worked:
                                e.target.value === "" ? "" : clampHours(Number(e.target.value)),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-10"
                          aria-label={`More hours for ${emp.full_name}`}
                          onClick={() =>
                            updateRow(emp.id, { hours_worked: clampHours(hours + 0.5) })
                          }
                          disabled={hours >= MAX_HOURS}
                        >
                          <Plus className="size-4" aria-hidden="true" />
                        </Button>
                        <span className="text-xs text-muted-foreground">hours</span>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No hours counted</p>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-10 text-xs text-muted-foreground"
                      aria-expanded={!!openNotes[emp.id]}
                      onClick={() => setOpenNotes((prev) => ({ ...prev, [emp.id]: !prev[emp.id] }))}
                    >
                      <StickyNote className="mr-1.5 size-4" aria-hidden="true" />
                      {row.notes ? "Note" : "Add note"}
                    </Button>
                  </div>

                  {openNotes[emp.id] && (
                    <Input
                      aria-label={`Note for ${emp.full_name}`}
                      placeholder="Reason, late arrival, early finish…"
                      value={row.notes}
                      onChange={(e) => updateRow(emp.id, { notes: e.target.value })}
                      className="h-10"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-lg space-y-2">
          <p className="text-center text-xs text-muted-foreground" aria-live="polite">
            {counts.present} present · {counts.absent} absent · {counts.leave} leave · {counts.sick}{" "}
            sick
          </p>
          <Button
            className="h-14 w-full text-base"
            onClick={() => once(() => submit.mutateAsync()).catch(() => {})}
            disabled={submit.isPending || total === 0}
          >
            {submit.isPending ? "Saving…" : "Save attendance"}
          </Button>
        </div>
      </div>
    </div>
  );
}
