# Runnable API surface

Both implementations expose the same `/v1` contract. The comprehensive product
contract remains in `activity-social-app-product/api/openapi.yaml`; this runtime
slice implements the five-tab product loop and the infrastructure paths needed to
exercise it locally.

| Area | Endpoints |
|---|---|
| System | `GET /system/health`, `GET /system/config`, `GET /metrics` |
| Discovery | `GET /feed`, `GET /search`, `GET /activities/nearby` |
| Media | `POST /media/uploads`, `POST /media/uploads/:id/complete`, `GET /media/:id` |
| Publishing | `POST /posts`, `GET /posts/:id`, `POST /posts/:id/publish`, `POST /activities`, `POST /activities/:id/publish`, `POST /activities/:id/join` |
| Matching | `GET /matching/candidates`, `POST /matching/swipes` |
| Messaging | `GET /conversations`, `GET/POST /conversations/:id/messages` |
| Profile | `GET/PATCH /me/profile` |
| AI | `POST /ai/plan`, `POST /ai/generations`, `GET /ai/generations/:id` |
| Agent | `GET /agent/manifest`, `GET /agent/tools` |

Local authenticated calls use `Authorization: Bearer demo-user`. Health and
configuration endpoints are public.
