import { definePermissions } from "@seller-hub/core";

// EXAMPLE permissions: `<k>.permissions.ts` default-exports { permission, roles[] }[].
export default definePermissions([
  { permission: "example.read", roles: ["owner", "admin", "manager", "analyst", "viewer"] },
  { permission: "example.write", roles: ["owner", "admin", "manager"] },
]);
