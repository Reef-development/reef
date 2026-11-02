import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 sm:mb-8 animate-fade-up">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.28em] uppercase text-accent-foreground/70 font-medium mb-1">R.E.E.F · Operations</div>
          <h1 className="text-display text-2xl sm:text-3xl md:text-4xl font-normal text-foreground truncate">{title}</h1>
          {description && <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="mining-rule mt-4 opacity-60" />
    </div>
  );
}