# AUTH.md (M11)

## Authentication Modes

- `guest` mode: no `Authorization` header. Data is created with `owner_user_id = NULL`.
- `user` mode: `Authorization: Bearer <access_token>`. Data is created with `owner_user_id = current_user.id`.
- `admin` mode: bearer token user with `admin` role.

## APIs

### `POST /api/auth/register`

Request body:

```json
{
  "username": "alice",
  "password": "abc12345",
  "display_name": "Alice",
  "email": "alice@example.com"
}
```

Rules:

- username must be unique.
- password must be at least 8 chars and include letters + digits.
- created user defaults to active + non-admin.

Response is backward-compatible with login:

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "user": { "id": 2, "username": "alice", "roles": ["user"] }
}
```

### `POST /api/auth/login`

Unchanged contract; returns bearer token and user roles.

### `GET /api/auth/me`

Unchanged contract; requires bearer token.

## Admin Initialization

The API process supports bootstrap admin on startup:

- `INIT_ADMIN_USERNAME`
- `INIT_ADMIN_PASSWORD`

If the user exists, admin role is ensured. If not, user is created and bound to admin role.

## Token Notes

- Token signing secret comes from `AUTH_TOKEN_SECRET` (fallback exists for local demo only).
- Token is required for all `/api/admin/*` endpoints.

## Multi-tenant Isolation Rules

For non-admin access:

- guest can read/delete only rows with `owner_user_id IS NULL`.
- logged-in user can read/delete only rows with `owner_user_id = self`.
- admin can read all and can use `scope=all`/`scope=guest` on supported list APIs.

Enforced endpoints include:

- `/api/tasks`, `/api/tasks/{task_id}`, `/api/tasks/bulk-delete`, `/api/tasks/{task_id} DELETE`
- `/api/files/{task_id}/{filename}`
- `/api/time-series/*` list/detail/points/bulk-delete
- `/api/admin/*` admin role only

## Admin Compat Token

`ADMIN_TOKEN` weak mode is deprecated and disabled by default. Current admin access is role-based bearer only.
