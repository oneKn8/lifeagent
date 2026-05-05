import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { signSession, verifySession } from "./session";

const ORIGINAL = process.env.SESSION_SECRET;

describe("session jwt", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret!!";
  });
  afterEach(() => {
    process.env.SESSION_SECRET = ORIGINAL;
  });

  it("signs and verifies a session", async () => {
    const token = await signSession("12345");
    const claims = await verifySession(token);
    expect(claims?.sub).toBe("12345");
  });

  it("rejects garbage tokens", async () => {
    const claims = await verifySession("not-a-jwt");
    expect(claims).toBeNull();
  });

  it("rejects tokens signed with a different secret", async () => {
    const token = await signSession("123");
    process.env.SESSION_SECRET = "another-secret-another-secret-1234";
    const claims = await verifySession(token);
    expect(claims).toBeNull();
  });
});
