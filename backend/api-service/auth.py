"""
Optional Auth0 JWT validation. If AUTH0_DOMAIN is not set, auth is skipped (local dev).
"""
import os
from typing import Optional

import jwt
from fastapi import HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "").rstrip("/")
AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "")
security = HTTPBearer(auto_error=False)


def get_jwks_uri() -> str:
    return f"https://{AUTH0_DOMAIN}/.well-known/jwks.json"


async def verify_token(credentials: Optional[HTTPAuthorizationCredentials]) -> Optional[dict]:
    """Verify JWT and return payload (sub, email, name). Return None if auth disabled or no token."""
    if not AUTH0_DOMAIN or not AUTH0_AUDIENCE:
        return None
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authorization")
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.get(get_jwks_uri())
            r.raise_for_status()
            jwks = r.json()
        from jwt import PyJWKClient
        jwk_client = PyJWKClient(get_jwks_uri())
        signing_key = jwk_client.get_signing_key_from_jwt(credentials.credentials)
        payload = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256"],
            audience=AUTH0_AUDIENCE,
            options={"verify_exp": True},
        )
        return payload
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_optional_user(request: Request) -> Optional[dict]:
    """Return payload if valid JWT present; else None (auth disabled or no token)."""
    credentials = await security(request)
    if not AUTH0_DOMAIN:
        return None
    if not credentials:
        return None
    return await verify_token(credentials)
