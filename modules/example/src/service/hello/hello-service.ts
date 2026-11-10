import { DomainError, validationFailed, type Scope } from "@seller-hub/core";
import type { helloRepository } from "../../repository/hello/hello-repository";

export type HelloRepository = ReturnType<typeof helloRepository>;

// EXAMPLE service: business rules only, no HTTP and no SQL. Returns data or throws a DomainError that the
// API maps to the problem+json status (422 here).
export function helloService(repo: HelloRepository) {
  return {
    async status(scope: Scope): Promise<{ items: number }> {
      return { items: await repo.count(scope) };
    },

    async create(scope: Scope, greeting: string) {
      const text = greeting.trim();
      if (text.length === 0 || text.length > 80) {
        throw validationFailed([
          {
            path: "/greeting",
            code: text.length === 0 ? "required" : "too_long",
            meta: { max: 80 },
          },
        ]);
      }
      if (text.toLowerCase() === "forbidden") {
        throw new DomainError("conflict", "greeting_reserved", "That greeting is reserved");
      }
      return repo.create(scope, text);
    },
  };
}
