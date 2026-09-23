import * as React from "react";
import { Input } from "@/components/ui/input";

type Props = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (n: number) => void;
};

/**
 * Number input that never traps you behind a leading "0".
 * Keeps a text draft while typing, so clearing the field is allowed and
 * typing "100" over a "0" just works.
 */
export function NumberField({ value, onValueChange, placeholder = "0", ...rest }: Props) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (value === 0 ? "" : String(value));
  return (
    <Input
      {...rest}
      type="number"
      inputMode={rest.inputMode ?? "decimal"}
      placeholder={placeholder}
      value={shown}
      onChange={(e) => {
        setDraft(e.target.value);
        onValueChange(e.target.value === "" ? 0 : Number(e.target.value));
      }}
      onBlur={(e) => {
        setDraft(null);
        rest.onBlur?.(e);
      }}
    />
  );
}
