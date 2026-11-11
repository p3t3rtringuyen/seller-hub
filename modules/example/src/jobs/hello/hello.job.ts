import { defineJob } from "@seller-hub/core";

// EXAMPLE job (non-sync consumer): queue name is `<module>.<job>`, discovered from jobs/<key>/*.job.ts.
export default defineJob({
  queue: "example.hello-greet",
  async process({ data, log }) {
    log.debug({ tenantId: data.tenantId }, "example greeting job");
    return { greeted: true };
  },
});
