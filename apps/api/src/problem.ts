import { STATUS_BY_KIND, type DomainError, type FieldError } from "@seller-hub/core";

// RFC 9457 problem details (conventions §3). The status is always the real HTTP status.

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  traceId: string;
  errors?: FieldError[];
}

const TITLES: Record<number, string> = {
  400: "Bad request",
  401: "Authentication required",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  422: "Validation failed",
  428: "Confirmation required",
  429: "Too many requests",
  500: "Internal error",
  502: "Amazon request failed",
  503: "Service unavailable",
};

export function problem(
  status: number,
  code: string,
  traceId: string,
  detail?: string,
  errors?: FieldError[],
): Problem {
  return {
    type: `https://seller-hub.dev/problems/${code.replace(/_/g, "-")}`,
    title: TITLES[status] ?? "Error",
    status,
    code,
    ...(detail ? { detail } : {}),
    traceId,
    ...(errors?.length ? { errors } : {}),
  };
}

export const fromDomainError = (e: DomainError, traceId: string): Problem =>
  problem(STATUS_BY_KIND[e.kind], e.code, traceId, e.message, e.errors);
