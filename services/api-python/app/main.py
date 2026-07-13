import json
import time
from contextlib import asynccontextmanager
from typing import Any, Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .auth import authenticated_user
from .config import settings
from .infra import infra
from .models import (
    ActivityInput,
    AiGenerationInput,
    MediaUploadInput,
    MessageInput,
    PlanInput,
    PostInput,
    SwipeInput,
)
from .service import service


@asynccontextmanager
async def lifespan(_: FastAPI):
    infra.open()
    yield
    infra.close()


app = FastAPI(
    title="Dachang Runtime API — Python",
    version="0.1.0",
    description="FastAPI parity implementation of the five-tab activity-social vertical slice",
    lifespan=lifespan,
    docs_url="/v1/docs",
    openapi_url="/v1/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/demo-assets", StaticFiles(directory=settings.demo_assets_dir), name="demo-assets")


@app.middleware("http")
async def request_context(request: Request, call_next):
    started = time.perf_counter()
    correlation_id = request.headers.get("x-correlation-id", str(uuid4()))
    request.state.correlation_id = correlation_id
    response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    print(
        json.dumps(
            {
                "level": "info",
                "service": "api-python",
                "correlationId": correlation_id,
                "method": request.method,
                "path": request.url.path,
                "statusCode": response.status_code,
                "latencyMs": round((time.perf_counter() - started) * 1000),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return response


UserId = Annotated[str, Depends(authenticated_user)]


@app.get("/v1/system/health")
def health() -> dict[str, Any]:
    return service.health()


@app.get("/v1/system/config")
def config() -> dict[str, Any]:
    return service.config()


@app.get("/v1/metrics")
def metrics() -> Response:
    return Response(service.metrics(), media_type="text/plain; version=0.0.4")


@app.get("/v1/feed")
def feed(user_id: UserId, mode: str = "recommended", cityCode: str = "310100") -> dict[str, Any]:
    return service.feed(user_id, mode, cityCode)


@app.get("/v1/search")
def search(user_id: UserId, q: str = Query(min_length=1), types: str | None = None) -> dict[str, Any]:
    return service.search(user_id, q, types)


@app.get("/v1/activities/nearby")
def nearby(
    user_id: UserId,
    cityCode: str = "310100",
    categories: str | None = None,
    participantMax: int = Query(default=50, ge=2, le=50),
) -> dict[str, Any]:
    return service.nearby(user_id, cityCode, categories, participantMax)


@app.get("/v1/me/profile")
def profile(user_id: UserId) -> dict[str, Any]:
    return service.profile(user_id)


@app.patch("/v1/me/profile")
def update_profile(payload: dict[str, Any], user_id: UserId) -> dict[str, Any]:
    return service.update_profile(user_id, payload)


@app.get("/v1/matching/candidates")
def candidates(user_id: UserId) -> dict[str, Any]:
    return service.candidates(user_id)


@app.post("/v1/matching/swipes")
def swipe(payload: SwipeInput, user_id: UserId) -> dict[str, Any]:
    return service.swipe(user_id, payload.targetUserId, payload.decision)


@app.get("/v1/conversations")
def conversations(user_id: UserId) -> dict[str, Any]:
    return service.conversations(user_id)


@app.post("/v1/users/{target_user_id}/block")
def block_user(target_user_id: str, payload: dict[str, Any], user_id: UserId) -> dict[str, Any]:
    mode = "silent" if payload.get("mode") == "silent" else "standard"
    raw_reason_code = payload.get("reason_code", payload.get("reasonCode"))
    reason_code = str(raw_reason_code) if raw_reason_code else None
    return service.block_user(user_id, target_user_id, mode, reason_code)


@app.delete("/v1/users/{target_user_id}/block", status_code=204)
def unblock_user(target_user_id: str, user_id: UserId) -> None:
    service.unblock_user(user_id, target_user_id)


@app.get("/v1/me/blocks")
def blocks(user_id: UserId) -> dict[str, Any]:
    return service.blocks(user_id)


@app.get("/v1/conversations/{conversation_id}/messages")
def messages(conversation_id: str, user_id: UserId) -> dict[str, Any]:
    return service.messages(user_id, conversation_id)


@app.post("/v1/conversations/{conversation_id}/messages", status_code=201)
def send_message(conversation_id: str, payload: MessageInput, user_id: UserId) -> dict[str, Any]:
    return service.send_message(user_id, conversation_id, payload.text, payload.clientMessageId)


@app.post("/v1/media/uploads", status_code=201)
def create_media_upload(payload: MediaUploadInput, user_id: UserId) -> dict[str, Any]:
    return service.create_media_upload(user_id, payload.model_dump())


@app.post("/v1/media/uploads/{upload_id}/complete", status_code=202)
def complete_media_upload(upload_id: str, user_id: UserId) -> dict[str, Any]:
    return service.complete_media_upload(user_id, upload_id)


@app.get("/v1/media/{media_id}")
def media(media_id: str, user_id: UserId) -> dict[str, Any]:
    return service.media(media_id)


@app.post("/v1/posts", status_code=201)
def create_post(
    payload: PostInput,
    user_id: UserId,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any]:
    return service.create_post(user_id, payload, idempotency_key)


@app.get("/v1/posts/{post_id}")
def post(post_id: str, user_id: UserId) -> dict[str, Any]:
    return service.post(post_id)


@app.post("/v1/posts/{post_id}/publish", status_code=202)
def publish_post(post_id: str, user_id: UserId) -> dict[str, Any]:
    return service.publish_post(user_id, post_id)


@app.post("/v1/activities", status_code=201)
def create_activity(payload: ActivityInput, user_id: UserId) -> dict[str, Any]:
    return service.create_activity(user_id, payload)


@app.post("/v1/activities/{activity_id}/publish", status_code=202)
def publish_activity(activity_id: str, user_id: UserId) -> dict[str, Any]:
    return service.publish_activity(user_id, activity_id)


@app.post("/v1/activities/{activity_id}/join")
def join_activity(activity_id: str, user_id: UserId) -> dict[str, Any]:
    return service.join_activity(user_id, activity_id)


@app.post("/v1/ai/plan")
def plan_activity(payload: PlanInput, request: Request, user_id: UserId) -> dict[str, Any]:
    return service.plan(
        user_id,
        payload.prompt,
        payload.participantTarget,
        request.state.correlation_id,
    )


@app.post("/v1/ai/generations", status_code=202)
def create_ai_generation(payload: AiGenerationInput, user_id: UserId) -> dict[str, Any]:
    return service.create_ai_generation(user_id, payload.purpose, payload.prompt)


@app.get("/v1/ai/generations/{job_id}")
def ai_generation(job_id: str, user_id: UserId) -> dict[str, Any]:
    return service.ai_generation(job_id)


@app.get("/v1/agent/manifest")
def agent_manifest(user_id: UserId) -> dict[str, Any]:
    return service.agent_manifest()


@app.get("/v1/agent/tools")
def agent_tools(user_id: UserId) -> dict[str, Any]:
    return service.agent_tools()
