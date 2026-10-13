"""link bill payments to expenses

Revision ID: 6fc7fe3eab44
Revises: 84d87ea8f72f
Create Date: 2026-10-13 05:29:25.910407

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6fc7fe3eab44"
down_revision: str | Sequence[str] | None = "84d87ea8f72f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("bill_payments", sa.Column("expense_id", sa.Integer(), nullable=True))
    # The constraint is named here (with the name PostgreSQL would have given
    # it) so that downgrade() can drop it by that name.
    op.create_foreign_key(
        "bill_payments_expense_id_fkey",
        "bill_payments",
        "expenses",
        ["expense_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("bill_payments_expense_id_fkey", "bill_payments", type_="foreignkey")
    op.drop_column("bill_payments", "expense_id")
