import type { CallEvent } from "../observer";
import type { AmazonMode } from "../regions";
import type { RetryPolicy } from "../retry";
import { createAmazonRuntime } from "../runtime";
import type { AmazonRuntime, AmazonRuntimeOptions } from "../runtime";
import type { HttpTransport } from "../types";
import { MockTransport } from "./mock-transport";
import { ManualClock, fakeCredentialSource, mockLwa } from "./support";
import type { FakeCredentialSource } from "./support";

export interface TestRuntime {
  runtime: AmazonRuntime;
  /** The in-memory Amazon. Register routes on it; read `requests` to assert on what was sent. */
  transport: MockTransport;
  clock: ManualClock;
  credentials: FakeCredentialSource;
  /** Every finished call, in order (the same events the logger observer would log). */
  events: CallEvent[];
}

export interface TestRuntimeOptions {
  mode?: AmazonMode;
  retry?: RetryPolicy;
  /** Replace the mock transport (for example a replay transport). */
  transport?: HttpTransport;
  overrides?: Partial<AmazonRuntimeOptions>;
}

/**
 * A complete Amazon runtime on a mock transport, a manual clock (sleeping is instant) and fake credentials, with a
 * working LWA endpoint. Slices use it to test code that calls `packages/amazon-*` without the network.
 */
export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  const transport = new MockTransport();
  mockLwa(transport);
  const clock = new ManualClock();
  const credentials = fakeCredentialSource();
  const events: CallEvent[] = [];
  const runtime = createAmazonRuntime({
    credentials,
    mode: options.mode ?? "production",
    transport: options.transport ?? transport,
    clock,
    random: () => 0.5,
    observer: { onCall: (e) => events.push(e) },
    ...(options.retry ? { retry: options.retry } : {}),
    ...options.overrides,
  });
  return { runtime, transport, clock, credentials, events };
}
