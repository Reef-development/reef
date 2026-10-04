import type { HistoryQuery, ListQuery } from "@reef/shared";

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
  /** The plant this user belongs to. Null for the owner, who sees every plant. */
  plantFor(userId: string): Promise<string | null>;
}

/** Who is asking. `plant` is null for the owner, who sees every plant. */
export type UserContext = {
  role: string;
  plant: string | null;
};

/**
 * Same as `Repository`, but every method receives the caller, so the implementation can
 * scope its queries. Stock uses this: a manager or worker sees only their own plant; an
 * owner sees every plant. The plant filter lives inside the implementation, so a route
 * that forgets to pass the user cannot compile, and a screen that forgets to filter
 * cannot leak.
 */
export interface ScopedRepository<Row, Input, Patch> {
  list(query: ListQuery, user: UserContext): Promise<Page<Row>>;
  get(id: string, user: UserContext): Promise<Row | null>;
  create(input: Input, user: UserContext): Promise<Row>;
  update(
    id: string,
    patch: Patch,
    expectedVersion: number,
    user: UserContext,
  ): Promise<UpdateResult<Row>>;
  remove(id: string, user: UserContext): Promise<boolean>;
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
