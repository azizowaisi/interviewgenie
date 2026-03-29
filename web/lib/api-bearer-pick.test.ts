import { describe, expect, it } from "vitest";

import { shouldSetAuthorizationFromSdkAccessToken } from "./api-bearer-pick";

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
