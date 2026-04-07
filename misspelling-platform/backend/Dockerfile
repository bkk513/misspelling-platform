# 文件说明：后端服务镜像构建文件，负责安装依赖并打包 FastAPI 与 Celery 运行环境。

FROM mcr.microsoft.com/devcontainers/python:3.11

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
