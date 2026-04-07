"""文件说明：Celery 应用入口，负责定义异步任务队列与 Worker 连接配置。"""

import os
from celery import Celery

celery_app = Celery(
    "misspelling_platform",
    broker=os.getenv("CELERY_BROKER_URL"),
    backend=os.getenv("CELERY_RESULT_BACKEND"),
    include=["app.tasks"],  # 关键：显式加载任务模块
)

celery_app.conf.update(
    task_track_started=True,
    result_expires=3600,
    broker_connection_retry_on_startup=True,
)
