# Frontend (M6 Minimal UI)

Minimal researcher-facing demo UI built with React + Vite + TypeScript.

## Run (PowerShell)

```powershell
Set-Location .\misspelling-platform\frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Backend dependency

- Start backend/API/worker first:

```powershell
Set-Location ..\
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

Vite proxies `/health` and `/api/*` to `http://127.0.0.1:8000` by default.

Optional proxy target override:

```powershell
$env:VITE_PROXY_TARGET="http://127.0.0.1:8000"
npm run dev
```
