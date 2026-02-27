from sqlalchemy import text

from .core import get_engine


def count_users() -> int:
    with get_engine().begin() as conn:
        return int(conn.execute(text("SELECT COUNT(*) FROM users")).scalar_one())


def get_user_by_username(username: str):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT id, username, password_hash, is_active, is_admin, created_at
                    FROM users
                    WHERE username=:username
                    LIMIT 1
                    """
                ),
                {"username": username},
            )
            .mappings()
            .first()
        )


def get_user_by_id(user_id: int):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT id, username, display_name, email, is_active, is_admin, created_at, updated_at
                    FROM users
                    WHERE id=:user_id
                    LIMIT 1
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )


def ensure_role(name: str) -> int:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO roles (name, description)
                VALUES (:name, :description)
                ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)
                """
            ),
            {"name": name, "description": f"{name} role"},
        )
        return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())


def ensure_user_role(user_id: int, role_name: str) -> None:
    role_id = ensure_role(role_name)
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT IGNORE INTO user_roles (user_id, role_id)
                VALUES (:user_id, :role_id)
                """
            ),
            {"user_id": user_id, "role_id": role_id},
        )


def list_user_roles(user_id: int) -> list[str]:
    with get_engine().begin() as conn:
        rows = (
            conn.execute(
                text(
                    """
                    SELECT r.name
                    FROM user_roles ur
                    JOIN roles r ON r.id = ur.role_id
                    WHERE ur.user_id = :user_id
                    ORDER BY r.name
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
    return [str(r["name"]) for r in rows]


def create_user(username: str, password_hash: str, is_admin: bool = False) -> int:
    with get_engine().begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO users (username, password_hash, is_active, is_admin)
                VALUES (:username, :password_hash, 1, :is_admin)
                """
            ),
            {"username": username, "password_hash": password_hash, "is_admin": 1 if is_admin else 0},
        )
        user_id = int(result.lastrowid)
    ensure_user_role(user_id, "admin" if is_admin else "user")
    return user_id


def update_user_password(user_id: int, password_hash: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE users
                SET password_hash=:password_hash
                WHERE id=:user_id
                """
            ),
            {"user_id": user_id, "password_hash": password_hash},
        )


def update_user_active(user_id: int, is_active: bool) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE users
                SET is_active=:is_active
                WHERE id=:user_id
                """
            ),
            {"user_id": user_id, "is_active": 1 if is_active else 0},
        )


def list_users(limit: int = 100):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT
                      u.id,
                      u.username,
                      u.is_active,
                      u.is_admin,
                      u.created_at,
                      GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ',') AS roles
                    FROM users u
                    LEFT JOIN user_roles ur ON ur.user_id = u.id
                    LEFT JOIN roles r ON r.id = ur.role_id
                    GROUP BY u.id
                    ORDER BY u.id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            )
            .mappings()
            .all()
        )
