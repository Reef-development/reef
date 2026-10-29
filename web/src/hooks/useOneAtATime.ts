import { useCallback, useRef } from "react";

/**
 * Runs a save at most once at a time. Disabling the button while the save is pending is not
 * enough on its own: the disabled state only reaches the screen after React re-renders, so an
 * impatient double tap lands twice and creates two records. This flag flips the instant the
 * first tap arrives, before any re-render, and the second tap is ignored.
 */
export function useOneAtATime() {
  const busy = useRef(false);
  return useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    try {
      return await work();
    } finally {
      busy.current = false;
    }
  }, []);
}
