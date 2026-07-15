from typing import Annotated, Any

import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient

from .config import settings


_jwks_client = PyJWKClient(settings.supabase_jwks_url, lifespan=600) if settings.supabase_jwks_url else None


def _verify_supabase_token(token: str) -> dict[str, Any]:
    if not _jwks_client or not settings.supabase_url:
        raise ValueError("Supabase Auth is not configured")
    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "RS256"],
        audience=settings.supabase_jwt_audience,
        issuer=f"{settings.supabase_url}/auth/v1",
    )


def authenticated_user(authorization: Annotated[str | None, Header()] = None) -> str:
    token = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else ""
    if token == settings.auth_token and settings.auth_mode != "supabase":
        return settings.demo_user_id
    if not token or settings.auth_mode == "demo":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "A valid access token is required")

    try:
        payload = _verify_supabase_token(token)
        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject:
            raise ValueError("JWT subject is missing")
        return subject
    except Exception as error:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "A valid Supabase access token is required",
        ) from error
