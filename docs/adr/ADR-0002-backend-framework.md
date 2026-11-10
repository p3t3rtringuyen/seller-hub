# ADR-0002 — Backend framework and module structure

Status: Accepted, pending Gate 2 (D20) · Date: 2026-11-10 · Task: P2-ARCH

## Context

D3 a leaves NestJS vs Fastify to this ADR. Constraints: contract-first OpenAPI (ADR-0010); the worker
(BullMQ) must run the same services and repositories as the API without an HTTP layer; slices add routes
without editing shared files; every route must be authenticated and permission-checked by default (legacy traps
4, 5, 8: unauthenticated routes, 46 routes without role checks, handlers calling Amazon directly).

## Options

| Option | For | Against |
|---|---|---|
| **NestJS 11** (Fastify adapter) | strong conventions (modules, DI, guards, pipes) that keep many sessions uniform; large ecosystem | decorator/DI magic; code-first OpenAPI (swagger decorators) fights contract-first; services tied to the Nest container, so the worker either boots a Nest context or duplicates wiring; slower cold start; class-validator duplicates the JSON Schema we already have |
| **Fastify 5 + explicit composition** | JSON-Schema-native validation and serialisation (Ajv) — the OpenAPI bundle *is* the validator; plugin encapsulation per module; plain functions/classes reusable from the worker; fast | conventions must be written down and linted (this ADR + boundaries lint); fewer batteries |
| Hono / Express | small, portable | Express: no schema validation, slower; Hono: thinner Node ecosystem for our needs (multipart, OTel auto-instrumentation) |

## Decision

**Fastify 5** with explicit composition (factory functions, no DI container).

Module structure (`modules/<name>/src`):

```
routes/      Fastify plugin: binds operationIds from the contract to handlers
handlers/    HTTP adapter: parse (already schema-validated) input, call service, map result → response
service/     business rules, permission-independent; takes Scope + typed input; returns Result<T, DomainError>
repository/  Kysely queries; Scope mandatory; no business logic
sync/        *.sync.ts — sync definitions for the worker (ADR-0008)
commands/    *.command.ts — command handlers for Amazon writes (ADR-0011)
index.ts     public entry: service factories + types other modules may use
```

Layering: handler → service → repository; service → `packages/amazon-*` only for interactive lookups; Amazon
writes only through commands (ADR-0011).

Validation ownership:
1. **Shape** (types, required, enums, string formats, max lengths): Fastify/Ajv from the OpenAPI bundle, before
   the handler runs. Response bodies are serialised against the contract too (no accidental field leaks).
2. **Business rules** (marketplace bid/budget bounds, name rules UX-16, state transitions, cross-field rules):
   the service, returning typed `DomainError`s that handlers map to 422 with `errors[]` (conventions §3).
3. **Authorization**: a global `preHandler` reads the route's `x-permission` and `x-scope` from the contract
   (ADR-0010). **Default-deny**: at boot, a route without `x-permission` (or an explicit `x-public: true`) aborts
   startup. Tenant/seller-account scope is resolved once and passed as `Scope`.

Process wiring: `apps/api/src/main.ts` builds config → db → redis → amazon clients → module services → Fastify,
registering module route plugins from the generated registry (ADR-0001). `apps/worker` builds the same services
without Fastify.

## Consequences

- No framework container to learn; reviewers check the layering rules with lint (`boundaries`) and a test that
  lists every route with its permission.
- Error mapping, request id, auth, rate limiting and OpenTelemetry are Fastify plugins in `apps/api` written once
  in P3-SCAFFOLD / P3-IDENTITY.
- Services are callable from tests directly (no HTTP) and from the worker.

## Revisit when

The team grows beyond agent sessions and wants Nest's conventions, or Fastify's JSON-schema path stops matching
OpenAPI 3.1 features we rely on.
