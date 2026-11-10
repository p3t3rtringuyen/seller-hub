import { defineCommand } from "@seller-hub/core";

// EXAMPLE command handler (ADR-0011 shape): `kind`, payload JSON Schema, permission, batchMax, apply().
// The payload schema is mirrored in contracts/modules/example/hello.yaml with `x-command-kind`.
export default defineCommand<{ text: string }>({
  kind: "example.hello.echo",
  payloadSchema: {
    type: "object",
    required: ["text"],
    properties: { text: { type: "string", maxLength: 80 } },
  },
  permission: "example.write",
  batchMax: 10,
  async apply(_scope, items) {
    return items.map((_, index) => ({ index, status: "succeeded" as const }));
  },
});
