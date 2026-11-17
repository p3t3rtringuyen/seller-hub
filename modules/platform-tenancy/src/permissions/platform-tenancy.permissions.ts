import { definePermissions } from "@seller-hub/core";

// Platform permissions (ADR-0004 decision 3). The five fixed roles of D55 a; effective permission = union of the
// role grants for the scope. Feature slices declare their own permissions in their own files.
const ALL = ["owner", "admin", "manager", "analyst", "viewer"] as const;

export default definePermissions([
  // reading platform data (every member)
  { permission: "session.read", roles: ALL },
  { permission: "members.read", roles: ALL },
  { permission: "accounts.read", roles: ALL },
  { permission: "connections.read", roles: ALL },
  { permission: "ref.read", roles: ALL },
  // administration
  { permission: "tenant.manage", roles: ["owner"] },
  { permission: "members.manage", roles: ["owner", "admin"] },
  { permission: "connections.manage", roles: ["owner", "admin"] },
]);
