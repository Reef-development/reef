import type { ListQuery } from "@reef/shared";

export type Page<T> = { rows: T[]; total: number };

/**
 * An update either lands, finds the record was changed by someone else since the caller read it
 * (and returns the current copy), or finds no record at all.
 */
export type UpdateResult<Row> =
  { status: "updated"; row: Row } | { status: "stale"; current: Row } | { status: "missing" };

/**
 * What a route needs from storage, and nothing about how it is stored. Handlers depend on this
 * interface only, so the Supabase implementation can be swapped for a direct Postgres one
 * (WBS 5.2, T25) or an in-memory one in tests without touching a route.
 */
export interface Repository<Row, Input, Patch> {
  list(query: ListQuery): Promise<Page<Row>>;
  get(id: string): Promise<Row | null>;
  create(input: Input): Promise<Row>;
  /** Applies the patch only if the stored version still equals `expectedVersion`. */
  update(id: string, patch: Patch, expectedVersion: number): Promise<UpdateResult<Row>>;
  remove(id: string): Promise<boolean>;
}

export interface RoleRepository {
  /** Every role name held by the user, as stored. */
  forUser(userId: string): Promise<string[]>;
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
