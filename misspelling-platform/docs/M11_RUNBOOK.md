# M11_RUNBOOK.md

## Scope

Runbook for M11 features:

- self-service register/login
- guest/user/admin data isolation
- task/time-series bulk delete
- admin purge controls
- extended health status

## Preconditions

1. Start Docker Desktop.
2. Optional env for admin bootstrap:

```powershell
$env:INIT_ADMIN_USERNAME="admin"
$env:INIT_ADMIN_PASSWORD="your-password"
```

3. Optional env for LLM:

```powershell
$env:DASHSCOPE_API_KEY="<redacted>"
$env:BAILIAN_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
$env:BAILIAN_MODEL="qwen-plus"
```

## Baseline Acceptance

```powershell
Set-Location .\misspelling-platform
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

Expected: all original PASS lines remain green.

## Manual Demo Steps

### 1) Register + Login

1. Open frontend `/login`.
2. Switch to `Register`, create a normal user.
3. Verify auto-login redirects to `/app/dashboard`.

### 2) User-owned data isolation

1. As logged-in user, create `word-analysis` and `simulation-run`.
2. Open `/app/tasks`: records should be visible for current user.
3. Logout to guest, create another task.
4. Login again as user: guest-owned task should not be visible in default scope.

### 3) Bulk delete

1. In `Task Center`, select multiple rows -> `Delete Selected`.
2. In `Time Series Explorer`, select multiple series -> `Delete Selected`.
3. Confirm list refresh reflects deletion results.

### 4) Admin all-scope + purge

1. Login as admin.
2. Open `/admin/settings`.
3. Run `Purge Guest Data` (or purge by `User ID`).
4. Verify corresponding records disappear in app lists.

### 5) Extended health and degrade signal

1. Open dashboard and check system cards:
   - DB / Redis / LLM / GBNC
2. If no LLM key configured, card must show disabled and warning banner.

## Notes

- Guest compatibility is preserved for legacy check flow.
- Admin-only APIs require bearer token with admin role.
- Bulk deletion obeys ownership checks server-side.
