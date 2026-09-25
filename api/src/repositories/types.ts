import type { ListQuery } from "@reef/shared";

export type Page<T> = { rows: T[]; total: number };

/**
 * An update either lands, finds the record was changed by someone else since the caller read it
 * (and returns the current copy), or finds no record at all.
 */
export type UpdateResult<Row> =
  | { status: "updated"; row: Row }
  | { status: "stale"; current: Row }
  | { status: "missing" };

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
