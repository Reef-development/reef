import { AlertTriangle, RefreshCw, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api";

/**
 * What the screen needs to recover from a refused save: their copy, what this person typed, and
 * the copy they started from (to tell which fields they actually changed).
 */
export type Conflict<T = Record<string, unknown>> = {
  current: T;
  typed: Record<string, unknown>;
  original: Record<string, unknown>;
};

/** Turns a failed save into a Conflict if the server refused it because someone else saved first. */
export function conflictFrom<T>(
  error: unknown,
  typed: Record<string, unknown>,
  original: Record<string, unknown>,
): Conflict<T> | null {
  if (!(error instanceof ApiRequestError) || error.code !== "CONFLICT") return null;
  const current = (error.details as { current?: T } | undefined)?.current;
  return current ? { current, typed, original } : null;
}

const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Equal as a person sees them: empty and missing match, and 220 matches "220". */
export const sameValue = (a: unknown, b: unknown) => shown(a) === shown(b);

/**
 * The fields the person did not change before saving. When their version is loaded these take
 * the other person's values; leaving the old values in place would overwrite that person's
 * change on the next save, which is exactly what the version check exists to prevent.
 */
export function untouchedFields(conflict: Conflict, keys: string[]): string[] {
  return keys.filter((k) => sameValue(conflict.typed[k], conflict.original[k]));
}

/**
 * Shown inside an edit dialog when a save was refused because the record changed underneath the
 * person. It never clears the form: it lists what the other person changed next to what this
 * person typed, and offers to load the latest version so the next save is made against it.
 */
export function ConflictNotice<T extends Record<string, unknown>>({
  conflict,
  reloaded,
  labels,
  noun,
  format = (_key, value) => shown(value),
  onReload,
}: {
  conflict: Conflict<T> | null;
  reloaded: boolean;
  /** Field name → label, for the fields this form edits. */
  labels: Record<string, string>;
  noun: string;
  /** How to show a value, e.g. a client name instead of its id. */
  format?: (key: string, value: unknown) => string;
  onReload: (current: T) => void;
}) {
  if (reloaded) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Their latest version is loaded</AlertTitle>
        <AlertDescription>
          What you typed is still in the form. Fields you had not changed now show their values. Press Save to apply
          your changes on top of theirs.
        </AlertDescription>
      </Alert>
    );
  }
  if (!conflict) return null;

  const differences = Object.entries(labels).filter(
    ([key]) => key in conflict.typed && shown(conflict.current[key]) !== shown(conflict.typed[key]),
  );

  return (
    <Alert variant="destructive" aria-live="assertive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Someone else saved this {noun} while you were editing</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>Your changes have not been saved yet, and nothing you typed has been lost.</p>
        {differences.length > 0 && (
          <table className="w-full text-xs text-foreground">
            <caption className="sr-only">Their saved values compared with what you typed</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-2 font-medium">Field</th>
                <th scope="col" className="py-1 pr-2 font-medium">Their version</th>
                <th scope="col" className="py-1 font-medium">What you typed</th>
              </tr>
            </thead>
            <tbody>
              {differences.map(([key, label]) => (
                <tr key={key} className="border-t border-destructive/20">
                  <th scope="row" className="py-1 pr-2 text-left font-medium">{label}</th>
                  <td className="py-1 pr-2">{format(key, conflict.current[key])}</td>
                  <td className="py-1">{format(key, conflict.typed[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => onReload(conflict.current)}>
          <RefreshCw className="mr-1 h-4 w-4" />
          Load their version and keep my typing
        </Button>
      </AlertDescription>
    </Alert>
  );
}
