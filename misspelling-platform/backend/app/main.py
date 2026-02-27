from fastapi import FastAPI

from .api.routes_admin import router as admin_router
from .api.routes_auth import router as auth_router
from .api.routes_tasks import router as tasks_router
from .api.routes_timeseries import router as timeseries_router
from .services.auth_service import ensure_init_admin_from_env


def create_app() -> FastAPI:
    ensure_init_admin_from_env()
    app = FastAPI(title="Misspelling Platform API (MVP)")
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(tasks_router)
    app.include_router(timeseries_router)
    return app


app = create_app()
