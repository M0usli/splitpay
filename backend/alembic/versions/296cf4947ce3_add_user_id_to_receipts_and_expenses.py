"""add user_id to receipts and expenses

Revision ID: 296cf4947ce3
Revises: e52846e4d9de
Create Date: 2026-10-11 09:16:59.501356

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "296cf4947ce3"
down_revision: str | Sequence[str] | None = "e52846e4d9de"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = ("receipts", "expenses")


def upgrade() -> None:
    """Give every receipt and expense an owner.

    Autogenerate wrote "add a required column", which fails on a table that
    already has rows: they would have no owner. So this is done in three
    steps: add the column allowing empty values, fill it in, then make it
    required.
    """
    connection = op.get_bind()
    for table in TABLES:
        # 1. Add the column, empty for now.
        op.add_column(table, sa.Column("user_id", sa.Integer(), nullable=True))

        # 2. Rows from before accounts existed go to the first account.
        connection.execute(sa.text(f"UPDATE {table} SET user_id = (SELECT min(id) FROM users)"))
        ownerless = connection.execute(
            sa.text(f"SELECT count(*) FROM {table} WHERE user_id IS NULL")
        ).scalar()
        if ownerless:
            raise RuntimeError(
                f"{ownerless} rows in {table} have no owner because there are no accounts yet. "
                "Sign up in the app first (with the previous version), then run this again."
            )

        # 3. From now on every row must have an owner.
        op.alter_column(table, "user_id", nullable=False)
        op.create_index(op.f(f"ix_{table}_user_id"), table, ["user_id"], unique=False)
        op.create_foreign_key(
            f"{table}_user_id_fkey", table, "users", ["user_id"], ["id"], ondelete="CASCADE"
        )


def downgrade() -> None:
    """Remove the owner columns. Which user owned which row is lost."""
    for table in TABLES:
        op.drop_constraint(f"{table}_user_id_fkey", table, type_="foreignkey")
        op.drop_index(op.f(f"ix_{table}_user_id"), table_name=table)
        op.drop_column(table, "user_id")
