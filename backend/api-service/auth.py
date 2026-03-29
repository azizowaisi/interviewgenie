"""
Optional Auth0 JWT validation. If AUTH0_DOMAIN is not set, auth is skipped (local dev).
"""
import os
from typing import Optional

import jwt
from fastapi import HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


def _normalize_auth0_domain(raw: str) -> str:
    """Host only, no scheme — fixes JWKS URL when env is set to https://tenant.auth0.com."""
    d = (raw or "").strip().rstrip("/")
    low = d.lower()
    if low.startswith("https://"):
        d = d[8:]
    elif low.startswith("http://"):
        d = d[7:]
    return d.rstrip("/")


AUTH0_DOMAIN = _normalize_auth0_domain(os.getenv("AUTH0_DOMAIN", ""))
AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "").strip()
# Same as the Auth0 Application "Client ID" (public). When set, we accept ID tokens
# (aud = client_id) as well as API access tokens (aud = AUTH0_AUDIENCE) — needed if
# the SPA session has no separate API access token yet.
AUTH0_CLIENT_ID = os.getenv("AUTH0_CLIENT_ID", "").strip()
security = HTTPBearer(auto_error=False)


def get_jwks_uri() -> str:
    return f"https://{AUTH0_DOMAIN}/.well-known/jwks.json"


async def verify_token(credentials: Optional[HTTPAuthorizationCredentials]) -> Optional[dict]:
    """Verify JWT and return payload (sub, email, name). Return None if auth disabled or no token."""
    if not AUTH0_DOMAIN:
        return None
    if not credentials:
        return None
    # BFF often forwards an ID token (aud = client_id). API access tokens use AUTH0_AUDIENCE.
    # Production had api-service with CLIENT_ID set but AUDIENCE missing from the secret → 503 on every authenticated call.
    if not AUTH0_AUDIENCE and not AUTH0_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Set AUTH0_CLIENT_ID (and ideally AUTH0_AUDIENCE) when AUTH0_DOMAIN is set",
        )
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.get(get_jwks_uri())
            r.raise_for_status()
        from jwt import PyJWKClient
        jwk_client = PyJWKClient(get_jwks_uri())
        signing_key = jwk_client.get_signing_key_from_jwt(credentials.credentials)
        audiences = [a for a in (AUTH0_AUDIENCE, AUTH0_CLIENT_ID) if a]
        if not audiences:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        payload = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256"],
            audience=audiences if len(audiences) > 1 else audiences[0],
            options={"verify_exp": True},
        )
        return payload
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_optional_user(request: Request) -> Optional[dict]:
    """Return payload if valid JWT present; else None (auth disabled or no token)."""
    credentials = await security(request)
    if not AUTH0_DOMAIN:
        return None
    if not credentials:
        return None
    return await verify_token(credentials)
