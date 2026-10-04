import type { HistoryQuery, JobRun, ListQuery, Notification } from "@reef/shared";
import type { Machine } from "../services/service-due.js";

export type { HistoryQuery };

export type Page<T> = { rows: T[]; total: number };

/**
 * An update either lands, finds the record was changed by someone else since the caller
 * read it (and returns the current copy), or finds no record at all.
 */
export type UpdateResult<Row> =
  { status: "updated"; row: Row } | { status: "stale"; current: Row } | { status: "missing" };

/**
 * What a route needs from storage, and nothing about how it is stored. Handlers depend
 * on this interface only, so the Supabase implementation can be swapped for a direct
 * Postgres one (WBS 5.2, T25) or an in-memory one in tests without touching a route.
 */
export interface Repository<Row, Input, Patch> {
  list(query: ListQuery): Promise<Page<Row>>;
  get(id: string): Promise<Row | null>;
  create(input: Input): Promise<Row>;
  /**
   * Applies the patch only if the stored version still equals `expectedVersion`, and
   * records why the change was made. The row is updated through a stored procedure that
   * sets the reason on the transaction; a trigger reads it and writes the history row
   * inside the same transaction. A missing reason is refused before anything changes.
   */
  update(
    id: string,
    patch: Patch,
    expectedVersion: number,
    reason: string,
  ): Promise<UpdateResult<Row>>;
  remove(id: string): Promise<boolean>;
}

export interface RoleRepository {
  /** Every role name held by the user, as stored. */
  forUser(userId: string): Promise<string[]>;
}

/**
 * The shape of a row in the history table. Written by the database trigger after every
 * successful update. Rows are never updated or deleted.
 */
export type HistoryEntry = {
  id: string;
  table_name: string;
  row_id: string;
  changed_by: string;
  changed_at: string;
  reason: string;
  plant: string | null;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  version: number;
};

export interface HistoryRepository {
  /** Changes newest first, optionally for one table or one record. */
  list(query: HistoryQuery): Promise<Page<HistoryEntry>>;
}

/** An inclusive period, as two YYYY-MM-DD dates. */
export type Period = { from: string; to: string };

export type ProductionTotals = {
  tons: number;
  magnetiteCost: number;
  overtimeCost: number;
  days: number;
};

/**
 * What the money figures need from storage. Every method takes the period and one site, and
 * returns figures rather than rows: the arithmetic lives in the service so it can be tested
 * without a database, and so the same numbers cannot be worked out two different ways in two
 * different screens.
 */
export interface AnalyticsRepository {
  /** Sites the caller may see. Row-level security decides that, not this method. */
  mines(): Promise<{ id: string; name: string }[]>;
  productionTotals(mineId: string, period: Period): Promise<ProductionTotals>;
  productionByDay(mineId: string, period: Period): Promise<{ date: string; tons: number }[]>;
  /** Fixed monthly costs, apportioned to the days of the period that fall in each month. */
  fixedCosts(mineId: string, period: Period): Promise<number>;
  maintenanceCost(mineId: string, period: Period): Promise<number>;
  fuelCost(mineId: string, period: Period): Promise<number>;
  downtimeHours(mineId: string, period: Period): Promise<{ reason: string; hours: number }[]>;
}

/**
 * One person who has left, as the retention rules need them. The identity number itself is
 * deliberately not part of this shape: the question the report answers is whether one is still
 * stored, and answering it does not require reading it.
 */
export type Leaver = {
  id: string;
  full_name: string;
  employee_no: string | null;
  /** The date employment ended, as YYYY-MM-DD. Both periods are measured from it. */
  left_on: string;
  id_number_held: boolean;
};

export interface RetentionRepository {
  /** Everyone who has left and has a leaving date recorded. Nobody else has a period running. */
  leavers(): Promise<Leaver[]>;
}

/**
 * What the service sweep needs. It is deliberately separate from the request-scoped
 * repositories: the sweep runs with no user behind it, so it carries its own credential and
 * must never be reachable from a request.
 */
export interface ServiceSweepRepository {
  /** Every machine, with the next due figures from its most recent maintenance log. */
  machines(): Promise<Machine[]>;
  /** Who is told about a machine at this site. Owners and managers; workers do not book work in. */
  recipients(mineId: string | null): Promise<string[]>;
  /**
   * Creates the notifications that do not already exist, and returns how many were created.
   * A reminder already raised for the same machine and the same threshold is not raised again.
   */
  raise(rows: readonly NotificationDraft[]): Promise<number>;
}

export type NotificationDraft = {
  user_id: string;
  kind: "service_due";
  subject: string;
  body: string;
  equipment_id: string | null;
  mine_id: string | null;
  dedupe_key: string;
};

export interface JobRepository {
  /**
   * Takes the day for this job, by insert. True means this process owns the run; false means
   * another process already claimed it. Read-then-write would let two processes both sweep.
   */
  claim(job: string, ranFor: string): Promise<boolean>;
  finish(job: string, ranFor: string, outcome: string, detail: string): Promise<void>;
  runs(job: string, from: string, to: string): Promise<JobRun[]>;
}

/** A person's own notifications. Row-level security limits every call to the caller's rows. */
export interface NotificationRepository {
  list(userId: string, opts: { unread?: boolean; limit: number }): Promise<Notification[]>;
  markRead(userId: string, id: string): Promise<boolean>;
}
