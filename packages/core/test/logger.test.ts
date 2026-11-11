import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _e, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, logger: createLogger({ name: "t", level: "info", stream }) };
}

describe("log redaction (S2)", () => {
  it("redacts LWA/Amazon shaped objects, snake_case keys and nested headers", () => {
    const { lines, logger } = capture();
    logger.info(
      {
        access_token: "AT-secret",
        refresh_token: "RT-secret",
        client_secret: "CS-secret",
        lwa: { response: { access_token: "AT-nested", refresh_token: "RT-nested" } },
        headers: {
          "x-amz-access-token": "XA-secret",
          authorization: "Bearer B-secret",
          Authorization: "Bearer B2-secret",
        },
        err: {
          config: {
            headers: { Authorization: "Bearer E-secret", "x-amz-access-token": "XE-secret" },
            data: "grant_type=refresh_token&refresh_token=BODY-secret",
          },
        },
        call: { request: { headers: { cookie: "sh_session=C-secret" } } },
        keep: "visible",
      },
      "amazon call",
    );
    const out = lines.join("");
    for (const secret of [
      "AT-secret",
      "RT-secret",
      "CS-secret",
      "AT-nested",
      "RT-nested",
      "XA-secret",
      "B-secret",
      "B2-secret",
      "E-secret",
      "XE-secret",
      "BODY-secret",
      "C-secret",
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("visible");
    expect(out).toContain("[redacted]");
  });
});
