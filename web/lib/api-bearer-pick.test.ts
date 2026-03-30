import { describe, expect, it } from "vitest";

import { pickJwtBearer, pickJwtBearerForApi, shouldSetAuthorizationFromSdkAccessToken } from "./api-bearer-pick";

function b64Url(obj: unknown): string {
  const raw = Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
  return raw.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fakeJwt(payload: Record<string, unknown>): string {
  const header = { alg: "none", typ: "JWT" };
  return `${b64Url(header)}.${b64Url(payload)}.sig`;
}

describe("pickJwtBearer", () => {
  it("skips opaque tokens and returns first JWT", () => {
    expect(pickJwtBearer("opaque", "a.b.c", "x.y.z")).toBe("a.b.c");
    expect(pickJwtBearer(undefined, null, "")).toBeUndefined();
    expect(pickJwtBearer("a.b.c.d")).toBeUndefined();
  });

  it("skips expired JWTs and returns first non-expired JWT", () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = fakeJwt({ exp: now - 10, aud: "x" });
    const ok = fakeJwt({ exp: now + 3600, aud: "x" });
    expect(pickJwtBearer(expired, ok)).toBe(ok);
  });
});

describe("pickJwtBearerForApi", () => {
  const apiAud = "https://api.interviewgenie.teckiz.com";

  it("prefers id_token even when access token has wrong audience", () => {
    const now = Math.floor(Date.now() / 1000);
    const id = fakeJwt({ exp: now + 3600, aud: "client_id" });
    const wrongAt = fakeJwt({ exp: now + 3600, aud: "https://wrong.example" });
    expect(pickJwtBearerForApi(apiAud, id, wrongAt, wrongAt)).toBe(id);
  });

  it("uses access token only when aud matches API audience", () => {
    const now = Math.floor(Date.now() / 1000);
    const okAt = fakeJwt({ exp: now + 3600, aud: apiAud });
    expect(pickJwtBearerForApi(apiAud, null, okAt, null)).toBe(okAt);
    const wrongAt = fakeJwt({ exp: now + 3600, aud: "https://wrong.example" });
    expect(pickJwtBearerForApi(apiAud, null, wrongAt, null)).toBeUndefined();
  });
});

describe("shouldSetAuthorizationFromSdkAccessToken", () => {
  const apiAud = "https://api.interviewgenie.teckiz.com";

  it("does not forward SDK token when audience is required but missing or wrong (fall back to id_token)", () => {
    expect(shouldSetAuthorizationFromSdkAccessToken(apiAud, { token: "opaque-default", audience: undefined })).toBe(
      false,
    );
    expect(shouldSetAuthorizationFromSdkAccessToken(apiAud, { token: "jwt", audience: "https://wrong/" })).toBe(false);
    expect(shouldSetAuthorizationFromSdkAccessToken(apiAud, { token: "x.y.z", audience: `${apiAud} ` })).toBe(true);
  });

  it("forwards SDK token when audience matches", () => {
    expect(shouldSetAuthorizationFromSdkAccessToken(apiAud, { token: "x.y.z", audience: apiAud })).toBe(true);
  });

  it("when no AUTH0_AUDIENCE, forwards any non-empty token", () => {
    expect(shouldSetAuthorizationFromSdkAccessToken(undefined, { token: "anything" })).toBe(true);
    expect(shouldSetAuthorizationFromSdkAccessToken(undefined, { token: "" })).toBe(false);
    expect(shouldSetAuthorizationFromSdkAccessToken(undefined, undefined)).toBe(false);
  });
});
