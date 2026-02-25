import os

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "")
engine = create_engine(DATABASE_URL or "sqlite+pysqlite:///:memory:", pool_pre_ping=True)


def check_db() -> bool:
    if not DATABASE_URL:
        return False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
