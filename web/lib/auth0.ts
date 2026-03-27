import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0 SDK client (v4).
 * The SDK mounts /auth/* handlers via `auth0.middleware(...)`.
 */
export const auth0 = new Auth0Client();

