import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0 v4 does not read AUTH0_AUDIENCE from the environment. When calling a backend
 * that validates JWTs (our api-service), we must request an API access token at login
 * via authorizationParameters.audience, and pass the same audience to getAccessToken().
 */
function createClient(): Auth0Client {
  const audience = process.env.AUTH0_AUDIENCE?.trim();
  if (audience) {
    return new Auth0Client({
      authorizationParameters: {
        audience,
        scope: "openid profile email offline_access",
      },
    });
  }
  return new Auth0Client();
}

export const auth0 = createClient();
