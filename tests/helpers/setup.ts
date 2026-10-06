import { afterAll, afterEach } from "vitest";
import { destroyTintDevice, reportSkippedTint } from "@tests/helpers/compilers";

// A test that passed without its Tint assertions is reported as skipped
afterEach((context) => reportSkippedTint(context));

// The Dawn device keeps the worker process alive until it is destroyed
afterAll(() => destroyTintDevice());
