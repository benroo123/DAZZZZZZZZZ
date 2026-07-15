from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class PostInput(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    cityCode: str = "310100"
    mediaIds: list[str] = Field(default_factory=list, max_length=9)
    autoGenerateCover: bool = False

    @model_validator(mode="after")
    def cover_required(self) -> "PostInput":
        if not self.mediaIds and not self.autoGenerateCover:
            raise ValueError("A media asset or autoGenerateCover=true is required")
        return self


class ActivityInput(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=1, max_length=5000)
    category: str = Field(min_length=1, max_length=60)
    minParticipants: int = Field(ge=2, le=50)
    maxParticipants: int = Field(ge=2, le=50)
    startsAt: datetime
    endsAt: datetime
    cityCode: str = "310100"
    districtCode: str | None = None
    venueName: str | None = Field(default=None, max_length=120)
    mediaIds: list[str] = Field(default_factory=list, max_length=9)
    autoGenerateCover: bool = False

    @model_validator(mode="after")
    def valid_activity(self) -> "ActivityInput":
        if self.minParticipants > self.maxParticipants:
            raise ValueError("minParticipants cannot exceed maxParticipants")
        if self.endsAt <= self.startsAt:
            raise ValueError("endsAt must be later than startsAt")
        if not self.mediaIds and not self.autoGenerateCover:
            raise ValueError("A media asset or autoGenerateCover=true is required")
        return self


class MediaUploadInput(BaseModel):
    filename: str = Field(min_length=1, max_length=180)
    contentType: Literal["image/jpeg", "image/png", "image/webp", "video/mp4"]
    byteSize: int = Field(gt=0, le=200 * 1024 * 1024)
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    purpose: Literal["profile", "post", "activity", "message"] = "post"


class SwipeInput(BaseModel):
    targetUserId: str
    decision: Literal["pass", "like", "super_like"]


class MessageInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    clientMessageId: str = Field(min_length=1, max_length=80)


class PlanInput(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)
    cityCode: str = "310100"
    participantTarget: int = Field(default=6, ge=2, le=50)


class AiGenerationInput(BaseModel):
    purpose: Literal["post_cover", "activity_cover", "summary", "moderation_assist"]
    prompt: str = Field(min_length=1, max_length=5000)
