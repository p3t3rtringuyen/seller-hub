// What other modules and the composition root may import (through `@seller-hub/mod-platform-auth`).
export { authenticate, bearerToken, type AuthPrincipal } from "../authenticator";
export { authService, revokeSessionsOf } from "../container";
export {
  identityService,
  SESSION_IDLE_MS,
  SESSION_ABSOLUTE_MS,
} from "../service/platform-auth/identity-service";
export type { IdentityService, SessionIssued } from "../service/platform-auth/identity-service";
export { createLoginLimiter, type LoginLimiter } from "../service/platform-auth/login-limiter";
export { hashPassword, verifyPassword, passwordProblem } from "../crypto";
export {
  SESSION_HEADER,
  SESSION_MAX_AGE_HEADER,
  SESSION_CLEAR_HEADER,
} from "../handlers/platform-auth/auth-handlers";
