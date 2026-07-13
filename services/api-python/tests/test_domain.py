from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.models import ActivityInput, PostInput


def test_post_requires_media_or_ai_cover() -> None:
    with pytest.raises(ValidationError):
        PostInput(body="hello")
    assert PostInput(body="hello", autoGenerateCover=True).autoGenerateCover


def test_activity_participant_boundary() -> None:
    starts = datetime.now(UTC) + timedelta(days=2)
    valid = ActivityInput(
        title="周末活动",
        description="一起出发",
        category="运动",
        minParticipants=2,
        maxParticipants=50,
        startsAt=starts,
        endsAt=starts + timedelta(hours=2),
        autoGenerateCover=True,
    )
    assert valid.maxParticipants == 50
    with pytest.raises(ValidationError):
        ActivityInput(
            title="周末活动",
            description="一起出发",
            category="运动",
            minParticipants=8,
            maxParticipants=4,
            startsAt=starts,
            endsAt=starts + timedelta(hours=2),
            autoGenerateCover=True,
        )
