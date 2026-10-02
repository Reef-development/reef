import { useQuery } from "@tanstack/react-query";
import { DEFAULT_CAPTURE_MAX_AGE_DAYS, reefToday } from "@reef/shared";
import { api } from "@/lib/api";

/**
 * The owner's capture age limit (T10), for date pickers on capture forms. The API enforces
 * the limit; this only stops the picker offering dates the server will refuse.
 */
export function useCaptureLimit() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api<{ key: string; value: unknown }[]>("/api/v1/settings")).data,
    staleTime: 5 * 60_000,
  });
  const days = Number(
    settings.data?.find((s) => s.key === "capture_max_age_days")?.value ?? DEFAULT_CAPTURE_MAX_AGE_DAYS,
  );
  const today = reefToday();
  const earliest = new Date(`${today}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - days);
  return { days, today, earliest: earliest.toISOString().slice(0, 10) };
}
