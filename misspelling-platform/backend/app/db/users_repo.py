from sqlalchemy import text

from .core import get_engine


def get_user_by_username(username: str):
    with get_engine().begin() as conn:
        return conn.execute(text("SELECT * FROM users WHERE username=:u"), {"u": username}).mappings().first()


def get_user_by_id(user_id: int):
    with get_engine().begin() as conn:
        return conn.execute(text("SELECT * FROM users WHERE id=:id"), {"id": int(user_id)}).mappings().first()


def create_user(username: str, password_hash: str, is_admin: bool = False):
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO users (username, password_hash, display_name, is_active, is_admin)
                VALUES (:u, :p, :d, 1, :a)
                """
            ),
            {"u": username, "p": password_hash, "d": username, "a": 1 if is_admin else 0},
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())


def ensure_role(name: str, description: str = "") -> int:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO roles (name, description)
                VALUES (:n, :d)
                ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)
                """
            ),
            {"n": name, "d": description[:255]},
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())


def ensure_user_role(user_id: int, role_id: int) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO user_roles (user_id, role_id)
                VALUES (:u, :r)
                ON DUPLICATE KEY UPDATE created_at=created_at
                """
            ),
            {"u": int(user_id), "r": int(role_id)},
        )


def list_user_roles(user_id: int):
    with get_engine().begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT r.name
                FROM roles r JOIN user_roles ur ON ur.role_id=r.id
                WHERE ur.user_id=:u
                ORDER BY r.name
                """
            ),
            {"u": int(user_id)},
        ).mappings().all()
    return [str(r["name"]) for r in rows]


def list_users(limit: int = 100):
    with get_engine().begin() as conn:
        return conn.execute(
            text("SELECT id, username, display_name, is_active, is_admin, created_at FROM users ORDER BY id DESC LIMIT :n"),
            {"n": max(1, min(int(limit), 500))},
        ).mappings().all()


def set_user_password_hash(user_id: int, password_hash: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE users SET password_hash=:p, updated_at=CURRENT_TIMESTAMP WHERE id=:id"),
            {"id": int(user_id), "p": password_hash},
        )


def set_user_active(user_id: int, is_active: bool) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE users SET is_active=:a, updated_at=CURRENT_TIMESTAMP WHERE id=:id"),
            {"id": int(user_id), "a": 1 if is_active else 0},
        )
