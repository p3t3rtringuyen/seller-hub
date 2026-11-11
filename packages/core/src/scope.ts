/**
 * Tenant scope (conventions §10). Every repository function takes a Scope as its FIRST argument; the type
 * makes it mandatory and `requireScope` makes the omission fail at runtime too (JS callers, casts).
 */
export interface Scope {
  readonly tenantId: string;
  readonly sellerAccountId?: string;
  readonly userId?: string;
}

/** A scope that names one seller account. */
export interface SellerScope extends Scope {
  readonly sellerAccountId: string;
}

export function requireScope(scope: Scope | undefined | null): Scope {
  if (!scope || typeof scope.tenantId !== "string" || scope.tenantId === "") {
    throw new MissingScopeError();
  }
  return scope;
}

export function requireSellerScope(scope: Scope | undefined | null): SellerScope {
  const s = requireScope(scope);
  if (!s.sellerAccountId) throw new MissingScopeError("sellerAccountId is required");
  return s as SellerScope;
}

export class MissingScopeError extends Error {
  constructor(message = "a Scope with tenantId is required") {
    super(message);
    this.name = "MissingScopeError";
  }
}
