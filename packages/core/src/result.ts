export type Result<T, E = DomainError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export interface FieldError {
  /** JSON pointer into the request body, e.g. `/items/3/bid`. */
  path: string;
  code: string;
  message?: string;
  meta?: Record<string, unknown>;
}

/**
 * Typed domain failure returned by services (ADR-0002). The API maps `kind` to the HTTP status
 * (conventions §3) and renders an RFC 9457 problem; the worker records it on the job run.
 */
export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
    readonly errors: FieldError[] = [],
    readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export type DomainErrorKind =
  | "bad_request" // 400
  | "unauthenticated" // 401
  | "forbidden" // 403
  | "not_found" // 404
  | "conflict" // 409
  | "validation" // 422
  | "confirmation_required" // 428
  | "rate_limited" // 429
  | "upstream_failed" // 502
  | "upstream_throttled"; // 503

export const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 422,
  confirmation_required: 428,
  rate_limited: 429,
  upstream_failed: 502,
  upstream_throttled: 503,
};

export const notFound = (what = "resource") =>
  new DomainError("not_found", "not_found", `${what} not found`);
export const validationFailed = (errors: FieldError[]) =>
  new DomainError(
    "validation",
    "validation_failed",
    `${errors.length} field(s) are invalid`,
    errors,
  );
