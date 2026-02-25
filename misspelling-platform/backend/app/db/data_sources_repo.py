import json

from sqlalchemy import text

from .core import get_engine


def ensure_data_source(name: str = "stub_local", granularity: str = "day") -> int:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO data_sources (name, default_granularity, is_enabled, config_json)
                VALUES (:name, :granularity, 1, :config_json)
                ON DUPLICATE KEY UPDATE
                  id=LAST_INSERT_ID(id),
                  default_granularity=VALUES(default_granularity),
                  updated_at=CURRENT_TIMESTAMP
                """
            ),
            {"name": name, "granularity": granularity, "config_json": json.dumps({"stub": True})},
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())
