import type { ErrorCode } from "@reef/shared";
import type { ZodError } from "zod";

/** Thrown anywhere in a handler; the app's error handler turns it into the failure envelope. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function validationError(err: ZodError): ApiError {
  // An unknown field is reported against its own name, so a form can point at it.
  const details = err.issues.flatMap((i) =>
    i.code === "unrecognized_keys"
      ? i.keys.map((key) => ({ path: [...i.path, key].join("."), message: "This field is not accepted here" }))
      : [{ path: i.path.join("."), message: i.message }],
  );
  return new ApiError("VALIDATION_FAILED", "Some fields are missing or invalid", details);
}
