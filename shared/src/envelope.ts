/**
 * Every response from /api/v1 uses one of these two shapes, so a client can always tell
 * success from failure by looking for `error`, never by guessing from the status code alone.
 */
export type ApiSuccess<T> = { data: T; meta?: ListMeta };
export type ApiFailure = { error: { code: ErrorCode; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type ListMeta = { page: number; pageSize: number; total: number };

export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export function isFailure<T>(res: ApiResponse<T>): res is ApiFailure {
  return typeof res === "object" && res !== null && "error" in res;
}
