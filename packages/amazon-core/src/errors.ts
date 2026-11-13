import type { ApiFamily, Region } from "./regions";

// Typed failures of the Amazon client layer (ADR-0006). Messages never carry tokens or request bodies.
// `retryable` says whether the SAME request may be repeated later by a caller (the transport has already
// spent its own retry budget by the time one of these reaches the caller).

export interface ErrorContext {
  operation?: string;
  api?: ApiFamily;
  region?: Region;
  status?: number;
  requestId?: string;
}

export class AmazonClientError extends Error {
  readonly retryable: boolean = false;
  constructor(
    message: string,
    readonly context: ErrorContext = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A non-2xx answer from Amazon that is not covered by a more specific class. */
export class AmazonApiError extends AmazonClientError {
  override readonly retryable: boolean;
  constructor(
    message: string,
    context: ErrorContext & { status: number },
    readonly amazonCode: string | undefined,
    /** Sanitised copy of Amazon's error payload (never contains our credentials). */
    readonly details: unknown,
    retryable = false,
  ) {
    super(message, context);
    this.retryable = retryable;
  }
  get status(): number {
    return this.context.status ?? 0;
  }
}

/** 400 / 422: the request is wrong; repeating it will not help. */
export class AmazonValidationError extends AmazonApiError {}
/** 403 / 401 after a forced token refresh: the token is valid but not allowed (missing role, revoked app). */
export class AmazonAuthError extends AmazonApiError {}
export class AmazonNotFoundError extends AmazonApiError {}

/** 429 from Amazon after the retry budget was spent. */
export class AmazonThrottledError extends AmazonClientError {
  override readonly retryable = true;
  constructor(
    message: string,
    context: ErrorContext,
    readonly retryAfterMs: number,
  ) {
    super(message, context);
  }
}

/** 5xx or network failure after the retry budget was spent. */
export class AmazonUpstreamError extends AmazonClientError {
  override readonly retryable: boolean;
  constructor(
    message: string,
    context: ErrorContext,
    retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, context, options);
    this.retryable = retryable;
  }
}

/** Our own limiter refused to let the call go out (failFast mode, or the wait would exceed the caller's cap). */
export class LocalRateLimitError extends AmazonClientError {
  override readonly retryable = true;
  constructor(
    message: string,
    context: ErrorContext,
    readonly retryAfterMs: number,
  ) {
    super(message, context);
  }
}

/** LWA says the refresh token is dead (`invalid_grant`): the seller must reconnect (ADR-0005 step 6). */
export class ConnectionNeedsReauth extends AmazonClientError {
  constructor(
    readonly ref: { tenantId: string; sellerAccountId: string; api: ApiFamily; region: Region },
    message = "Amazon rejected the stored refresh token; the seller must reconnect",
  ) {
    super(message, { api: ref.api, region: ref.region });
  }
}

/** A restricted operation was called without a Restricted Data Token flow; D11 disables PII in MVP. */
export class PiiDisabled extends AmazonClientError {
  constructor(
    readonly operation: string,
    reason: string,
  ) {
    super(
      `Operation ${operation} is restricted (${reason}) and PII flows are disabled (D11); no call was made`,
      { operation, api: "sp" },
    );
  }
}

/** A call was made in `replay` mode with no fixture for it. */
export class ReplayMissError extends AmazonClientError {}

/** The caller asked for something the operation table does not allow (unknown operation, region not offered). */
export class OperationUsageError extends AmazonClientError {}
