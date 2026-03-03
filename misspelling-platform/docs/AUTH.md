# AUTH.md (M12)

## Identity Modes

- `guest`: request has no `Authorization` header.
- `user`: request has `Authorization: Bearer <token>`.
- `admin`: bearer user with role `admin`.

## Auth APIs

### `GET /api/auth/captcha`

- Returns a short-lived captcha payload (`captcha_id`, `captcha_text`, `ttl_seconds`).
- Captcha state is stored in Redis when available, otherwise in-memory fallback.

### `POST /api/auth/register`

Request:

```json
{
  "username": "alice",
  "password": "abc12345",
  "display_name": "Alice",
  "email": "alice@example.com",
  "captcha_id": "cap_xxx",
  "captcha_code": "AB12"
}
```

Rules:

- `username` must be unique.
- `password` must be >= 8 and contain letters + digits.
- captcha must match and be unexpired.
- created user defaults to active and non-admin.

Response is compatible with login:

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "user": { "id": 2, "username": "alice", "roles": ["user"] }
}
```

### `POST /api/auth/login`

- Validates credentials.
- Returns bearer token and roles.
- Successful/failed login writes `audit_logs`.

### `GET /api/auth/me`

- Requires bearer token.
- Returns current user id/username/roles/is_active.

## Token

- Token secret env: `AUTH_TOKEN_SECRET`.
- TTL defaults to 8 hours.
- Token is required for privileged APIs.

## Admin Bootstrap

On API startup, admin can be bootstrapped from:

- `INIT_ADMIN_USERNAME`
- `INIT_ADMIN_PASSWORD`

If user exists, admin role is ensured. If not, user is created.

## Authorization Policy

### Admin endpoints

- `/api/admin/*` requires bearer + `admin` role.
- `ADMIN_TOKEN` weak mode is deprecated and disabled by default.

### Owner-scoped resources

Current owner checks are enforced for:

- `tasks`
- `task_events` (via task visibility)
- `task_artifacts` (via task visibility)
- `time_series` / `time_series_points`
- `lexicon_terms` / `lexicon_variants`
- `report_exports`

Rules:

- guest sees only rows with `owner_user_id IS NULL`.
- user sees only rows with `owner_user_id = self`.
- admin can list all (`scope=all`) or guest subset (`scope=guest`) where supported.

## Frontend Session Consistency (M12 fix)

- Login/logout immediately remounts module pages by session key.
- Old polling loops are dropped on remount.
- Prevents transient display of stale task lists across identities.
