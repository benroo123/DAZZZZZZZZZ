import pytest
from fastapi import HTTPException

from app.auth import authenticated_user
from app.config import settings


def test_demo_token_maps_to_seeded_user() -> None:
    assert authenticated_user(f"Bearer {settings.auth_token}") == settings.demo_user_id


def test_missing_token_is_rejected() -> None:
    with pytest.raises(HTTPException) as error:
        authenticated_user(None)
    assert error.value.status_code == 401
