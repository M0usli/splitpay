"""The companies a bill can be paid to. All of them are made up.

They are a fixed list in code, not a database table: users cannot add
companies, and a real app would get this list from its payment provider.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Biller:
    code: str  # stored with saved billers and payments; never changes
    name: str
    kind: str  # what the bill is for, shown under the name


BILLERS: tuple[Biller, ...] = (
    Biller(code="northern-hydro", name="Northern Hydro", kind="Electricity"),
    Biller(code="maplenet", name="MapleNet", kind="Internet"),
    Biller(code="borealis-mobile", name="Borealis Mobile", kind="Mobile"),
    Biller(code="city-water", name="City Water", kind="Water"),
    Biller(code="lakeshore-gas", name="Lakeshore Gas", kind="Heating"),
)

BILLERS_BY_CODE: dict[str, Biller] = {biller.code: biller for biller in BILLERS}
