import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function ResourceDialog({
  title, trigger, children, onSave, editing, open: openProp, onOpenChange,
}: {
  title: string;
  /** null: the screen opens the dialog itself, so no trigger is rendered. */
  trigger?: ReactNode | null;
  children: (close: () => void) => ReactNode;
  onSave?: () => void | Promise<void>;
  editing?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [internal, setInternal] = useState(false);
  const open = openProp ?? internal;
  const setOpen = onOpenChange ?? setInternal;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === null ? null : trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" />Add</Button></DialogTrigger>
      )}
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? `Edit ${title}` : `New ${title}`}</DialogTitle></DialogHeader>
        {children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A labelled form field. The label wraps its control, so the two are tied together: a screen
 * reader announces the label with the control, and clicking the label focuses it. Every Field
 * holds one control.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}