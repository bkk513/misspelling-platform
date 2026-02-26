# AUTH.md (M8)

## Goal

M8 introduces username/password login and role-based admin access.

- `admin` users: can access `/api/admin/*`
- normal users: can login and use user-facing pages/APIs

Existing public demo endpoints remain backward-compatible for current check/demo flow, but admin APIs now require role-based auth by default.

## API Endpoints

### `POST /api/auth/login`

Request JSON:

- `username`
- `password`

Response:

- `access_token`
- `token_type` (`bearer`)
- `user` (`id`, `username`, `roles`)

### `GET /api/auth/me`

Headers:

- `Authorization: Bearer <access_token>`

Response:

- `user` (`id`, `username`, `display_name`, `roles`)

## Token Model (M8)

- Signed bearer token (HMAC-SHA256) implemented in `services/auth_service.py`
- Contains user id, username, roles, expiry
- Default TTL: 12 hours

Environment variable:

- `AUTH_TOKEN_SECRET` (recommended in non-demo deployments)

If unset, M8 uses a built-in demo fallback secret. For real deployment, always set `AUTH_TOKEN_SECRET`.

## Password Storage

- Passwords are hashed with `bcrypt`
- No plaintext passwords are stored in DB

## Roles / Admin Access

Admin endpoints (`/api/admin/*`) require:

- valid bearer token, and
- role list containing `admin`

### Deprecated compatibility mode

M8 keeps a temporary compatibility path for legacy `X-Admin-Token`, but it is disabled by default.

Required envs to enable deprecated mode:

- `ALLOW_ADMIN_TOKEN_COMPAT=1`
- `ADMIN_TOKEN=<value>`

This mode is logged with `ADMIN_TOKEN_COMPAT_USED` in `audit_logs` and should be removed in a future milestone.

## Initial Admin Bootstrap

On API startup, the app can create/bind an initial admin account from env vars:

- `INIT_ADMIN_USERNAME`
- `INIT_ADMIN_PASSWORD`

Behavior:

- if both vars are set and the user does not exist, create user with bcrypt password hash
- ensure roles `admin` and `user` exist
- bind the created/existing user to both roles

This bootstrap is idempotent for repeated startups.

## Frontend usage (M8)

- User side (`/`): optional login for demo identity
- Admin side (`/admin`): login is required to view Admin Console modules

The frontend stores access tokens in `sessionStorage` for local demo only.

## Environment variables summary (M8 Auth)

- `AUTH_TOKEN_SECRET`
- `INIT_ADMIN_USERNAME`
- `INIT_ADMIN_PASSWORD`
- `ALLOW_ADMIN_TOKEN_COMPAT` (deprecated path switch)
- `ADMIN_TOKEN` (deprecated compat mode only)

