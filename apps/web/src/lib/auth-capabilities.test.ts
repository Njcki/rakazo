import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthCapabilities } from "./auth-capabilities";

let fetchAuthCapabilities: () => Promise<AuthCapabilities>;
beforeEach(async () => {
  vi.resetModules();
  ({ fetchAuthCapabilities } = await import("./auth-capabilities"));
});

afterEach(() => vi.unstubAllGlobals());
const capability = {
  passwordAuth: false,
  sso: { name: "Example", availability: "unavailable" },
  passwordReset: false,
  resetUrl: null,
};
it("validates configured SSO even during discovery downtime", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(capability)),
  );
  await expect(fetchAuthCapabilities()).resolves.toEqual(capability);
});
it.each([
  {},
  { passwordReset: false, resetUrl: null, sso: null },
  { passwordReset: false, resetUrl: null, passwordAuth: false },
  { passwordReset: "false", resetUrl: null },
  { passwordReset: false, resetUrl: "invalid" },
  { passwordReset: false, resetUrl: null, billing: "false" },
  { passwordAuth: true },
  { ...capability, sso: {} },
  { ...capability, passwordAuth: "false" },
])("rejects malformed successful capabilities", async (body) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body)),
  );
  await expect(fetchAuthCapabilities()).rejects.toThrow();
});
it("rejects HTTP errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 503 })),
  );
  await expect(fetchAuthCapabilities()).rejects.toThrow();
});

it("accepts old capabilities for the bundled desktop client", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ passwordReset: false, resetUrl: null, billing: false })),
  );
  await expect(fetchAuthCapabilities()).resolves.toEqual({
    passwordAuth: true,
    sso: null,
    passwordReset: false,
    resetUrl: null,
    billing: false,
  });
});

it.each([null, { ...capability.sso, availability: "available" }])(
  "shares the pending and successful deployment lookup across callers with SSO %j",
  async (sso) => {
    const available = { ...capability, sso };
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const auth = fetchAuthCapabilities();
    const gate = fetchAuthCapabilities();
    expect(gate).toBe(auth);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(Response.json(available));
    await expect(auth).resolves.toEqual(available);
    await expect(fetchAuthCapabilities()).resolves.toEqual(available);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it("retries a failed deployment lookup", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json(capability));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchAuthCapabilities()).rejects.toThrow();
  await expect(fetchAuthCapabilities()).resolves.toEqual(capability);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["checking", "unavailable"])(
  "refreshes %s SSO discovery on the next lookup",
  async (availability) => {
    const fetch = vi.fn(async () =>
      Response.json({ ...capability, sso: { ...capability.sso, availability } }),
    );
    vi.stubGlobal("fetch", fetch);
    await fetchAuthCapabilities();
    await fetchAuthCapabilities();
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
