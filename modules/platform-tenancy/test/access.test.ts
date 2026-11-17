import type { Role } from "@seller-hub/core";
import { describe, expect, it } from "vitest";
import {
  effectiveRoles,
  permissionsFor,
  topRole,
  visibleSellerAccountIds,
  type Grant,
} from "../src/access";
import permissions from "../src/permissions/platform-tenancy.permissions";

const g = (
  role: Role,
  sellerAccountId: string | null = null,
  marketplaceId: string | null = null,
): Grant => ({
  role,
  sellerAccountId,
  marketplaceId,
});
const matrix = new Map(permissions.map((p) => [p.permission, new Set(p.roles)]));

describe("effectiveRoles (D55 a)", () => {
  it("tenant-wide grant applies to every seller account", () => {
    expect(effectiveRoles([g("manager")], "sa-1")).toEqual(["manager"]);
    expect(effectiveRoles([g("manager")], "sa-2")).toEqual(["manager"]);
  });
  it("a seller-account grant applies only to that account", () => {
    const grants = [g("admin", "sa-1")];
    expect(effectiveRoles(grants, "sa-1")).toEqual(["admin"]);
    expect(effectiveRoles(grants, "sa-2")).toEqual([]);
  });
  it("effective roles are the union of the grants for the scope", () => {
    expect(effectiveRoles([g("viewer"), g("manager", "sa-1")], "sa-1").sort()).toEqual([
      "manager",
      "viewer",
    ]);
  });
  it("at tenant level only tenant-wide grants count; seller-only members get the viewer floor", () => {
    expect(effectiveRoles([g("admin", "sa-1")], null)).toEqual(["viewer"]);
    expect(effectiveRoles([g("admin", "sa-1"), g("analyst")], null)).toEqual(["analyst"]);
    expect(effectiveRoles([], null)).toEqual([]);
  });
  it("a marketplace-narrowed grant (schema seam) confers nothing in the MVP", () => {
    expect(effectiveRoles([g("owner", null, "ATVPDKIKX0DER")], "sa-1")).toEqual([]);
  });
});

describe("permission matrix", () => {
  const can = (roles: Role[], p: string) => permissionsFor(roles, matrix).includes(p);
  it("only owners manage the tenant", () => {
    expect(can(["owner"], "tenant.manage")).toBe(true);
    expect(can(["admin"], "tenant.manage")).toBe(false);
  });
  it("owner and admin manage members and connections; manager, analyst and viewer do not", () => {
    for (const p of ["members.manage", "connections.manage"]) {
      expect(can(["owner"], p)).toBe(true);
      expect(can(["admin"], p)).toBe(true);
      for (const r of ["manager", "analyst", "viewer"] as Role[]) expect(can([r], p)).toBe(false);
    }
  });
  it("every role reads platform data", () => {
    for (const r of ["owner", "admin", "manager", "analyst", "viewer"] as Role[])
      for (const p of [
        "session.read",
        "members.read",
        "accounts.read",
        "connections.read",
        "ref.read",
      ])
        expect(can([r], p)).toBe(true);
  });
});

describe("visibility and ranking", () => {
  it("a tenant-wide grant sees all accounts, otherwise only the granted ones", () => {
    expect(visibleSellerAccountIds([g("viewer")], ["a", "b"])).toEqual(["a", "b"]);
    expect(visibleSellerAccountIds([g("viewer", "b")], ["a", "b"])).toEqual(["b"]);
    expect(visibleSellerAccountIds([], ["a"])).toEqual([]);
  });
  it("topRole picks the highest", () => {
    expect(topRole([g("viewer"), g("admin", "x")])).toBe("admin");
    expect(topRole([])).toBeNull();
  });
});
