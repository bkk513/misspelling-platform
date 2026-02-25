from fastapi import FastAPI

from .api.routes_tasks import router as tasks_router


def create_app() -> FastAPI:
    app = FastAPI(title="Misspelling Platform API (MVP)")
    app.include_router(tasks_router)
    return app


app = create_app()
