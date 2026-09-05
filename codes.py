"""Validation of barcode formats."""
import re

RE_BAG = re.compile(r"^sumka\d{5}$", re.I)
RE_EQUIP = re.compile(r"^dd\d{8}$", re.I)
RE_USER = re.compile(r"^us\d{6}$", re.I)
RE_CELL = re.compile(r"^DY(\d{6})(\d+)/(\d+)$", re.I)
RE_EAN = re.compile(r"^\d{8,14}$")
PROBLEM_ZONE = "PROBLEMNOE_OBORUDOVANIE"


def is_bag(code: str) -> bool:
    return bool(RE_BAG.match((code or "").strip()))


def is_equipment(code: str) -> bool:
    return bool(RE_EQUIP.match((code or "").strip()))


def is_user(code: str) -> bool:
    return bool(RE_USER.match((code or "").strip()))


def parse_cell(code: str):
    m = RE_CELL.match((code or "").strip())
    if not m:
        return None
    six = m.group(1)
    return {
        "code": code.strip().upper().replace("dy", "DY") if code[:2].lower() == "dy" else code.strip(),
        "warehouse_no": six[:3],
        "region": six[3:6],
        "shelf": m.group(2),
        "slot": m.group(3),
    }


def is_cell(code: str) -> bool:
    return parse_cell(code) is not None


def is_problem_zone(code: str) -> bool:
    return (code or "").strip().upper() == PROBLEM_ZONE.upper()


def is_ean(code: str) -> bool:
    return bool(RE_EAN.match((code or "").strip()))


def normalize(code: str) -> str:
    return (code or "").strip()
