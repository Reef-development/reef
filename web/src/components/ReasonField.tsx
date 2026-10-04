import { useCallback, useEffect } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";

/**
 * The same rule the API applies to `reason` on every update (T6), so a person hears about a
 * missing reason before the save, not after it. The API still checks it.
 */
const ReasonForm = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required when changing a record")
    .max(500, "The reason is too long (500 characters maximum)"),
});
type ReasonValues = z.infer<typeof ReasonForm>;

export type ChangeReason = {
  form: UseFormReturn<ReasonValues>;
  /**
   * Checks the box. Returns the reason, or null after showing the problem under the box and
   * moving focus to it, in which case the screen must not save.
   */
  confirm: () => Promise<string | null>;
};

export function useChangeReason(): ChangeReason {
  const form = useForm<ReasonValues>({
    resolver: zodResolver(ReasonForm),
    defaultValues: { reason: "" },
  });
  const confirm = useCallback(async () => {
    const valid = await form.trigger("reason", { shouldFocus: true });
    return valid ? form.getValues("reason").trim() : null;
  }, [form]);
  return { form, confirm };
}

/**
 * The reason box for a screen that changes an existing record. Built from the project's form
 * blocks, so the label, the error message and what a screen reader announces come with it.
 * It starts empty each time its dialog opens: a reason belongs to one change.
 */
export function ReasonField({ reason }: { reason: ChangeReason }) {
  const { form } = reason;
  useEffect(() => {
    form.reset({ reason: "" });
  }, [form]);
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Reason for this change</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                placeholder="e.g. Tons were captured wrong on the slip"
                {...field}
              />
            </FormControl>
            <FormDescription>Kept in the history with the old and new values.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
}
