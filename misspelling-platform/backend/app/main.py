from fastapi import FastAPI

from .api.routes_admin import router as admin_router
from .api.routes_lexicon import router as lexicon_router
from .api.routes_tasks import router as tasks_router
from .api.routes_timeseries import router as timeseries_router


def create_app() -> FastAPI:
    app = FastAPI(title="Misspelling Platform API (MVP)")
    app.include_router(tasks_router)
    app.include_router(timeseries_router)
    app.include_router(lexicon_router)
    app.include_router(admin_router)
    return app


app = create_app()
