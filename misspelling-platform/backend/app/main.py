"""文件说明：后端 FastAPI 应用入口，负责初始化服务、注册路由并暴露 API 应用实例。"""

from fastapi import FastAPI

from .api.routes_analytics import router as analytics_router
from .api.routes_admin import router as admin_router
from .api.routes_auth import router as auth_router
from .api.routes_data import router as data_router
from .api.routes_lexicon import router as lexicon_router
from .api.routes_projects import router as projects_router
from .api.routes_reports import router as reports_router
from .api.routes_tasks import router as tasks_router
from .api.routes_timeseries import router as timeseries_router
from .services.auth_service import ensure_init_admin_from_env
from .services.schema_bootstrap_service import ensure_project_analytics_schema


def create_app() -> FastAPI:
    # 启动时先补齐管理员账号与项目分析相关表，避免首次访问时再触发初始化分支。
    ensure_init_admin_from_env()
    ensure_project_analytics_schema()
    app = FastAPI(title="Misspelling Platform API (MVP)")
    # 路由统一在这里注册，老师问“接口从哪里接进来”时可以直接指向这一段。
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(tasks_router)
    app.include_router(data_router)
    app.include_router(timeseries_router)
    app.include_router(lexicon_router)
    app.include_router(projects_router)
    app.include_router(analytics_router)
    app.include_router(reports_router)
    return app


app = create_app()
