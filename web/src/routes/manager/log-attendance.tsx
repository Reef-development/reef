import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { reefToday } from "@reef/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/manager/log-attendance")({ component: Page });

type MyMine = { id: string; name: string } | null;
type RosterEntry = { id: string; full_name: string; position: string | null };
type AttendanceStatus = "present" | "absent" | "leave" | "sick";

type AttendanceState = {
  status: AttendanceStatus;
  hours_worked: number | "";
  notes: string;
};

function Page() {
  const today = reefToday();
  const [attendanceData, setAttendanceData] = useState<Record<string, AttendanceState>>({});
  const navigate = useNavigate();
  const qc = useQueryClient();

  // 1. Get the Manager's assigned mine (using the same pattern as the worker forms)
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

  // 2. Get the roster of active employees on this mine
  const roster = useQuery<RosterEntry[]>({
    queryKey: ["roster", myMine.data?.id],
    enabled: !!myMine.data?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("employees")
        .select("id, full_name, position")
        .eq("mine_id", myMine.data!.id)
        .eq("active", true)
        .order("full_name");
      return (data as RosterEntry[]) ?? [];
    },
  });

  // 3. Get existing attendance for today
  const existing = useQuery({
    queryKey: ["attendance", myMine.data?.id, today],
    enabled: !!myMine.data?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance")
        .select("employee_id, status, hours_worked, notes")
        .eq("mine_id", myMine.data!.id)
        .eq("date", today);
      return data ?? [];
    },
  });

  // Populate the form state when roster/existing data loads
  useEffect(() => {
    if (!roster.data) return;
    const initial: Record<string, AttendanceState> = {};
    roster.data.forEach((emp) => {
      const record = existing.data?.find((e) => e.employee_id === emp.id);
      initial[emp.id] = {
        status: (record?.status as AttendanceStatus) ?? "present",
        hours_worked: record?.hours_worked ?? 8, // default 8 hours
        notes: record?.notes ?? "",
      };
    });
    setAttendanceData(initial);
  }, [roster.data, existing.data]);

  const updateRow = (empId: string, updates: Partial<AttendanceState>) => {
    setAttendanceData((prev) => ({
      ...prev,
      [empId]: { ...prev[empId], ...updates },
    }));
  };

  const once = useOneAtATime();
  const submit = useMutation({
    mutationFn: async () => {
      if (!myMine.data) throw new Error("No mine assigned");
      const { data: auth } = await supabase.auth.getUser();
      
      const rows = Object.entries(attendanceData).map(([empId, data]) => ({
        mine_id: myMine.data!.id,
        employee_id: empId,
        date: today,
        status: data.status,
        hours_worked: data.hours_worked === "" ? null : Number(data.hours_worked),
        notes: data.notes.trim() || null,
        logged_by: auth.user?.id,
      }));

      const { error } = await supabase
        .from("attendance")
        .upsert(rows, { onConflict: "employee_id,date" });

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      toast.success("Attendance saved");
      navigate({ to: "/worker" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  if (myMine.isLoading || roster.isLoading) return <div>Loading roster...</div>;
  if (!myMine.data) return <div>No mine assigned. Contact owner.</div>;

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="text-xl font-bold">Log Attendance</h1>
        <p className="text-sm text-muted-foreground">{myMine.data.name} · {today}</p>
      </div>

      <div className="space-y-4">
        {roster.data?.length === 0 && <p>No active workers found on this mine.</p>}
        
        {roster.data?.map((emp) => (
          <div key={emp.id} className="p-4 border rounded-lg space-y-3 bg-card">
            <div>
              <p className="font-medium">{emp.full_name}</p>
              <p className="text-xs text-muted-foreground">{emp.position || "Worker"}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select 
                  value={attendanceData[emp.id]?.status} 
                  onValueChange={(v) => updateRow(emp.id, { status: v as AttendanceStatus })}
                >
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">Present</SelectItem>
                    <SelectItem value="absent">Absent</SelectItem>
                    <SelectItem value="leave">Leave</SelectItem>
                    <SelectItem value="sick">Sick</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs">Hours</Label>
                <Input 
                  type="number" 
                  step="0.5" 
                  className="h-10" 
                  value={attendanceData[emp.id]?.hours_worked} 
                  onChange={(e) => updateRow(emp.id, { hours_worked: e.target.value === "" ? "" : Number(e.target.value) })}
                  disabled={attendanceData[emp.id]?.status !== "present"}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button 
        className="w-full h-14 text-base fixed bottom-4 left-4 right-4 max-w-[calc(100%-2rem)] mx-auto" 
        onClick={() => once(() => submit.mutateAsync()).catch(() => {})} 
        disabled={submit.isPending || !roster.data?.length}
      >
        {submit.isPending ? "Saving…" : "Save Attendance"}
      </Button>
    </div>
  );
}