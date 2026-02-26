import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes_auth import router as auth_router
from .api.routes_data_gbnc import router as gbnc_data_router
from .api.routes_admin import router as admin_router
from .api.routes_lexicon import router as lexicon_router
from .api.routes_tasks import router as tasks_router
from .api.routes_timeseries import router as timeseries_router
from .services.auth_service import init_admin_from_env


def create_app() -> FastAPI:
    app = FastAPI(title="Misspelling Platform API (MVP)")
    origins = [o.strip() for o in os.getenv("CORS_ALLOW_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    @app.on_event("startup")
    def _init_admin():
        init_admin_from_env()
    app.include_router(tasks_router)
    app.include_router(timeseries_router)
    app.include_router(lexicon_router)
    app.include_router(gbnc_data_router)
    app.include_router(auth_router)
    app.include_router(admin_router)
    return app


app = create_app()
