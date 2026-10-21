
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional, List
import os

try:
    from database import Base, engine, get_db, SessionLocal
    from models import (
        User, Equipment, EquipmentType, Cell, Bag, Order, Operation, MissingReport, TransferPoint, UserChangeLog, Warehouse, ShiftEntry, Shipment, ShipmentItem
    )
    from auth import (
        hash_password, verify_password, make_token, get_current_user, require_roles, ROLE_LABELS
    )
    from codes import (
        is_bag, is_equipment, is_user, is_cell, parse_cell, is_problem_zone, is_ean, normalize, PROBLEM_ZONE
    )
    from seed import seed
except ImportError:
    from .database import Base, engine, get_db, SessionLocal
    from .models import (
        User, Equipment, EquipmentType, Cell, Bag, Order, Operation, MissingReport, TransferPoint, UserChangeLog, Warehouse, ShiftEntry, Shipment, ShipmentItem
    )
    from .auth import (
        hash_password, verify_password, make_token, get_current_user, require_roles, ROLE_LABELS
    )
    from .codes import (
        is_bag, is_equipment, is_user, is_cell, parse_cell, is_problem_zone, is_ean, normalize, PROBLEM_ZONE
    )
    from .seed import seed

Base.metadata.create_all(bind=engine)
# soft-add columns for existing sqlite
def _migrate():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        cols = {
            "orders": [
                ("object_info", "TEXT"),
                ("is_late", "BOOLEAN DEFAULT 0"),
                ("late_minutes", "INTEGER"),
                ("completion_requested_at", "DATETIME"),
                ("completed_at", "DATETIME"),
                ("completed_by", "VARCHAR(20)"),
                ("warehouse_code", "VARCHAR(10)"),
            ],
            "missing_reports": [
                ("kind", "VARCHAR(20) DEFAULT 'missing'"),
                ("shipment_id", "VARCHAR(20)"),
                ("warehouse_code", "VARCHAR(10)"),
            ],
            "users": [
                ("block_reason", "TEXT"),
                ("home_warehouse", "VARCHAR(10)"),
            ],
            "equipment": [
                ("warehouse_code", "VARCHAR(10)"),
                ("shipment_id", "VARCHAR(20)"),
            ],
            "cells": [
                ("warehouse_code", "VARCHAR(10)"),
            ],
            "bags": [
                ("warehouse_code", "VARCHAR(10)"),
            ],
            "operations": [
                ("shipment_id", "VARCHAR(20)"),
            ],
            "transfer_points": [
                ("warehouse_code", "VARCHAR(10)"),
            ],
        }
        for table, additions in cols.items():
            existing = set()
            try:
                rows = db.execute(text(f"PRAGMA table_info({table})")).fetchall()
                existing = {r[1] for r in rows}
            except Exception:
                continue
            for name, typ in additions:
                if name not in existing:
                    try:
                        db.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {typ}"))
                        db.commit()
                    except Exception:
                        db.rollback()
    finally:
        db.close()

try:
    _migrate()
except Exception as e:
    print("migrate skip", e)

db0 = SessionLocal()
try:
    seed(db0)
finally:
    db0.close()

app = FastAPI(title="Домовой", version="2.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

_here = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(os.path.dirname(_here))
for cand in [
    os.path.join(os.path.dirname(os.path.dirname(_here)), "frontend"),
    os.path.join(os.path.dirname(_here), "frontend"),
    _here,
    "/app/frontend",
]:
    if os.path.isfile(os.path.join(cand, "index.html")):
        FRONTEND = cand
        break

ORDER_LABELS = {
    "new": "Новый",
    "awaiting_assembly": "Ожидает сборки",
    "assembling": "Сборка",
    "assembling_late": "Сборка (опоздание)",
    "ready": "На точке передачи",
    "issued": "На заказе",
    "completion_pending": "Ожидает подтверждения завершения",
    "done": "Завершён",
    "cancelled": "Отменён",
}

class LoginIn(BaseModel):
    login: str
    password: str

class EmployeeIn(BaseModel):
    id: Optional[str] = None  # us + 6 цифр, если не указан — берётся свободный
    full_name: str
    birth_date: Optional[str] = None
    role: str
    password: Optional[str] = None

class EmployeeUpdateIn(BaseModel):
    full_name: Optional[str] = None
    birth_date: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    status: Optional[str] = None
    block_reason: Optional[str] = None

class BlockIn(BaseModel):
    reason: str

class PasswordChangeIn(BaseModel):
    old_password: Optional[str] = None
    new_password: str

class BagCreateIn(BaseModel):
    bag_id: str

class AdminSelfIn(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = None

class CellIn(BaseModel):
    code: str

class EanIn(BaseModel):
    ean: str
    name: str
    category: Optional[str] = None

class ScanIn(BaseModel):
    code: str

class AssemblyStartIn(BaseModel):
    bag_id: str
    order_id: str

class AssemblyItemIn(BaseModel):
    bag_id: str
    equipment_id: str

class AssemblyFinishIn(BaseModel):
    bag_id: str
    transfer_point: str

class IssueIn(BaseModel):
    executor_id: str
    bag_id: str

class UnpackItemIn(BaseModel):
    bag_id: str
    equipment_id: str
    cell_code: str

class DamageIn(BaseModel):
    bag_id: str
    equipment_id: str
    zone_code: str

class ReceiveIn(BaseModel):
    ean: str
    equipment_id: str

class PlaceIn(BaseModel):
    equipment_id: str
    cell_code: str

class OrderCreateIn(BaseModel):
    client_name: Optional[str] = None
    address: str
    cleaning_type: Optional[str] = None
    object_info: Optional[str] = None
    executor_id: Optional[str] = None
    cutoff_minutes: int = 10
    send_to_assembly: bool = True

class TransferPointIn(BaseModel):
    code: str
    name: str

class TransferPointUpdateIn(BaseModel):
    name: str

class ReturnBagIn(BaseModel):
    bag_id: str

class ReassignIn(BaseModel):
    executor_id: str

class MissingActionIn(BaseModel):
    report_id: int
    cell_code: Optional[str] = None

def touch_equipment(eq: Equipment, user_id: str):
    eq.last_user_2 = eq.last_user_1
    eq.last_user_1 = user_id

def log_op(db, type_, user_id, **kw):
    db.add(Operation(type=type_, user_id=user_id, **kw))

def log_user_change(db, user_id, changed_by, field, old, new):
    db.add(UserChangeLog(
        user_id=user_id, changed_by=changed_by, field=field,
        old_value=None if old is None else str(old),
        new_value=None if new is None else str(new),
    ))

def mark_late_if_needed(bag: Bag, order: Optional[Order]):
    if not bag.assembly_started_at:
        return
    mins = bag.cutoff_minutes or (order.cutoff_minutes if order else 10) or 10
    end = bag.assembly_started_at + timedelta(minutes=mins)
    if datetime.utcnow() > end:
        late = int((datetime.utcnow() - end).total_seconds() // 60)
        if order:
            order.is_late = True
            order.late_minutes = max(order.late_minutes or 0, late)
            if order.status == "assembling":
                order.status = "assembling_late"


# ---------- warehouses / shift / logistics helpers ----------
def is_warehouse_code(code: str) -> bool:
    c = normalize(code)
    return bool(c) and c.isdigit() and len(c) == 6

def is_shipment_id(code: str) -> bool:
    c = normalize(code)
    return bool(c) and c.isdigit() and len(c) == 11

def current_season(dt: Optional[datetime] = None):
    dt = dt or datetime.utcnow()
    m = dt.month
    y = dt.year
    if m in (6, 7, 8):
        return 1, y
    if m in (9, 10, 11):
        return 2, y
    if m in (12, 1, 2):
        return 3, y if m != 12 else y  # Dec belongs to season 3 of that year
    return 4, y  # 3,4,5

class WarehouseIn(BaseModel):
    code: str
    name: str
    is_main: bool = False

class ShiftMarkIn(BaseModel):
    user_id: str
    warehouse_code: str

class ShipmentCreateIn(BaseModel):
    shipment_id: str
    to_warehouse: str
    from_warehouse: str
    assembler_id: str
    kind: str = "transfer"  # transfer | return_defect

class ShipmentPackIn(BaseModel):
    shipment_id: str
    equipment_id: str

class ShipmentReceiveItemIn(BaseModel):
    shipment_id: str
    equipment_id: str
    cell_code: str

class ShipmentActionIn(BaseModel):
    shipment_id: str

# ---------- auth ----------
@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    login = normalize(data.login).lower()
    user = db.query(User).filter(User.id == login).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    if user.status == "fired":
        raise HTTPException(403, "Учётная запись отключена")
    return {
        "access_token": make_token(user.id, user.role),
        "user": {
            "id": user.id, "full_name": user.full_name, "role": user.role,
            "role_label": ROLE_LABELS.get(user.role, user.role),
            "status": user.status,
        },
    }

@app.get("/api/me")
def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id, "full_name": user.full_name, "role": user.role,
        "role_label": ROLE_LABELS.get(user.role, user.role),
        "status": user.status,
        "block_reason": user.block_reason if user.role == "admin" else None,
    }

# ---------- employees ----------
@app.get("/api/employees/next-id")
def next_employee_id(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    last = db.query(User).order_by(User.id.desc()).first()
    n = 1
    if last and last.id.startswith("us"):
        try:
            n = int(last.id[2:]) + 1
        except ValueError:
            n = 1
    return {"id": f"us{n:06d}"}

@app.get("/api/employees")
def list_employees(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    q = db.query(User).order_by(User.id)
    return [
        {"id": u.id, "full_name": u.full_name, "role": u.role,
         "role_label": ROLE_LABELS.get(u.role, u.role), "status": u.status,
         "birth_date": u.birth_date, "block_reason": u.block_reason}
        for u in q.all()
    ]

@app.get("/api/employees/search")
def search_employee(q: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    qn = normalize(q).lower()
    u = db.query(User).filter(User.id == qn).first()
    if not u:
        # partial
        rows = db.query(User).filter(User.id.contains(qn)).limit(10).all()
        return [{"id": x.id, "full_name": x.full_name, "role": x.role,
                 "role_label": ROLE_LABELS.get(x.role, x.role), "status": x.status,
                 "block_reason": x.block_reason, "birth_date": x.birth_date} for x in rows]
    return [{
        "id": u.id, "full_name": u.full_name, "role": u.role,
        "role_label": ROLE_LABELS.get(u.role, u.role), "status": u.status,
        "block_reason": u.block_reason, "birth_date": u.birth_date,
    }]

@app.post("/api/employees")
def create_employee(data: EmployeeIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if data.role not in ("cleaner", "handyman", "admin", "supervisor", "warehouse"):
        raise HTTPException(400, "Роль: supervisor / cleaner / handyman / admin")
    if data.id and data.id.strip():
        nid = normalize(data.id).lower()
        if not is_user(nid):
            raise HTTPException(400, "Формат учётки: us + 6 цифр, например us000107")
        if db.query(User).filter(User.id == nid).first():
            raise HTTPException(400, f"Учётка {nid} уже занята")
    else:
        nid = next_employee_id(db, user)["id"]
        while db.query(User).filter(User.id == nid).first():
            n = int(nid[2:]) + 1
            nid = f"us{n:06d}"
    pwd = data.password or "123456"
    u = User(
        id=nid, full_name=data.full_name, birth_date=data.birth_date,
        role=data.role,
        status="active", password_hash=hash_password(pwd),
    )
    db.add(u)
    log_user_change(db, u.id, user.id, "created", None, f"{u.role}/{u.full_name}")
    db.commit()
    return {"id": u.id, "full_name": u.full_name, "role": u.role, "password": pwd}

@app.patch("/api/employees/{emp_id}")
def update_employee(emp_id: str, data: EmployeeUpdateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Сотрудник не найден")
    if data.full_name is not None and data.full_name != u.full_name:
        log_user_change(db, u.id, user.id, "full_name", u.full_name, data.full_name)
        u.full_name = data.full_name
    if data.birth_date is not None and data.birth_date != u.birth_date:
        log_user_change(db, u.id, user.id, "birth_date", u.birth_date, data.birth_date)
        u.birth_date = data.birth_date
    if data.role is not None and data.role in ("warehouse", "cleaner", "handyman", "admin", "supervisor") and data.role != u.role:
        log_user_change(db, u.id, user.id, "role", u.role, data.role)
        u.role = data.role
    if data.status is not None and data.status in ("active", "blocked", "fired") and data.status != u.status:
        log_user_change(db, u.id, user.id, "status", u.status, data.status)
        u.status = data.status
        if data.status == "active":
            u.block_reason = None
    if data.block_reason is not None:
        log_user_change(db, u.id, user.id, "block_reason", u.block_reason, data.block_reason)
        u.block_reason = data.block_reason
    if data.password:
        log_user_change(db, u.id, user.id, "password", "***", "***")
        u.password_hash = hash_password(data.password)
    db.commit()
    return {"ok": True, "id": u.id}

@app.post("/api/employees/{emp_id}/block")
def block_employee(emp_id: str, data: BlockIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Не найден")
    if u.id == user.id:
        raise HTTPException(400, "Нельзя заблокировать себя")
    reason = (data.reason or "").strip()
    if not reason:
        raise HTTPException(400, "Укажите причину блокировки")
    log_user_change(db, u.id, user.id, "status", u.status, "blocked")
    log_user_change(db, u.id, user.id, "block_reason", u.block_reason, reason)
    u.status = "blocked"
    u.block_reason = reason
    db.commit()
    return {"ok": True, "message": f"{u.id} заблокирован"}

@app.post("/api/employees/{emp_id}/unblock")
def unblock_employee(emp_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Не найден")
    log_user_change(db, u.id, user.id, "status", u.status, "active")
    log_user_change(db, u.id, user.id, "block_reason", u.block_reason, None)
    u.status = "active"
    u.block_reason = None
    db.commit()
    return {"ok": True, "message": f"{u.id} разблокирован"}

@app.get("/api/employees/{emp_id}/history")
def employee_history(emp_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    rows = db.query(UserChangeLog).filter(UserChangeLog.user_id == emp_id).order_by(UserChangeLog.created_at.desc()).limit(100).all()
    return [{
        "field": r.field, "old_value": r.old_value, "new_value": r.new_value,
        "changed_by": r.changed_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]

@app.delete("/api/employees/{emp_id}")
def delete_employee(emp_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Не найден")
    if u.role == "admin":
        raise HTTPException(400, "Админа нельзя удалить")
    u.status = "fired"
    db.commit()
    return {"ok": True, "message": f"{emp_id} отключён"}

@app.post("/api/employees/{emp_id}/restore")
def restore_employee(emp_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Не найден")
    if u.status not in ("fired", "blocked"):
        raise HTTPException(400, f"Сейчас статус: {u.status}")
    try:
        log_user_change(db, u.id, user.id, "status", u.status, "active")
        log_user_change(db, u.id, user.id, "block_reason", u.block_reason, None)
    except NameError:
        pass
    u.status = "active"
    if hasattr(u, "block_reason"):
        u.block_reason = None
    db.commit()
    return {"ok": True, "message": f"{u.id} восстановлен, можно входить"}

# ---------- cells ----------
@app.post("/api/cells")
def add_cell(data: CellIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    parsed = parse_cell(data.code)
    if not parsed:
        raise HTTPException(400, "Неверный формат ячейки. Пример: DY0010661/2")
    code = data.code.strip()
    if code[:2].upper() == "DY":
        code = "DY" + code[2:]
    if db.query(Cell).filter(Cell.code == code).first():
        raise HTTPException(400, "Ячейка уже существует")
    cell = Cell(
        code=code, warehouse_no=parsed["warehouse_no"], region=parsed["region"],
        shelf=parsed["shelf"], slot=parsed["slot"], created_by=user.id,
    )
    db.add(cell)
    db.commit()
    return {"code": cell.code, "warehouse_no": cell.warehouse_no, "region": cell.region,
            "shelf": cell.shelf, "slot": cell.slot}

@app.get("/api/cells")
def list_cells(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    result = []
    for c in db.query(Cell).order_by(Cell.code).all():
        items = db.query(Equipment).filter(Equipment.cell_code == c.code, Equipment.status == "in_cell").all()
        result.append({
            "code": c.code, "warehouse_no": c.warehouse_no, "region": c.region,
            "shelf": c.shelf, "slot": c.slot,
            "count": len(items),
            "items": [{"id": e.id, "name": e.name, "ean": e.ean} for e in items],
        })
    return result

@app.delete("/api/cells/{code:path}")
def delete_cell(code: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    cell = db.query(Cell).filter(Cell.code == code).first()
    if not cell:
        raise HTTPException(404, "Ячейка не найдена")
    cnt = db.query(Equipment).filter(Equipment.cell_code == code, Equipment.status == "in_cell").count()
    if cnt:
        raise HTTPException(400, f"В ячейке есть оборудование ({cnt} шт). Сначала переместите.")
    db.delete(cell)
    db.commit()
    return {"ok": True}

# ---------- assembly board ----------
@app.get("/api/assembly/board")
def assembly_board(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    orders = db.query(Order).filter(
        Order.status.in_(["awaiting_assembly", "assembling", "assembling_late", "ready", "issued", "completion_pending"])
    ).order_by(Order.created_at).all()
    rows = []
    for o in orders:
        left = None
        is_late = bool(o.is_late)
        status_label = ORDER_LABELS.get(o.status, o.status)
        if o.bag_id:
            bag = db.query(Bag).filter(Bag.id == o.bag_id).first()
            if bag and bag.status == "assembling" and bag.assembly_started_at:
                mark_late_if_needed(bag, o)
                end = bag.assembly_started_at + timedelta(minutes=bag.cutoff_minutes or o.cutoff_minutes or 10)
                left = int((end - datetime.utcnow()).total_seconds() // 60)
                if left < 0:
                    is_late = True
                    o.is_late = True
                    o.late_minutes = abs(left)
                    if o.status == "assembling":
                        o.status = "assembling_late"
                    status_label = ORDER_LABELS["assembling_late"]
        elif o.status == "awaiting_assembly":
            left = o.cutoff_minutes
        rows.append({
            "order_id": o.id, "address": o.address, "status": o.status,
            "status_label": status_label, "cutoff_left": left,
            "cutoff_minutes": o.cutoff_minutes, "bag_id": o.bag_id,
            "executor_id": o.executor_id, "is_late": is_late,
            "late_minutes": o.late_minutes, "object_info": o.object_info,
            "client_name": o.client_name,
        })
    db.commit()
    return rows

@app.get("/api/bags")
def list_bags(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    labels = {
        "free": "Свободна",
        "assembling": "Собирается на заказ",
        "at_transfer": "Ожидает в точке передачи",
        "in_use": "В использовании",
        "awaiting_unpack": "Принята после исполнителя, ждёт разбор",
    }
    result = []
    for b in db.query(Bag).order_by(Bag.id).all():
        label = labels.get(b.status, b.status)
        if b.status == "in_use" and b.executor_id:
            label = f"В использовании ({b.executor_id})"
        if b.status == "assembling" and b.assembled_by:
            label = f"Собирается ({b.assembled_by})"
        result.append({
            "id": b.id, "status": b.status, "status_label": label,
            "order_id": b.order_id, "executor_id": b.executor_id,
            "assembled_by": b.assembled_by, "transfer_point": b.transfer_point,
        })
    return result

# ---------- assembly ----------
@app.post("/api/assembly/start")
def assembly_start(data: AssemblyStartIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки. Формат: sumka + 5 цифр")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    if bag.status == "assembling" and bag.assembled_by and bag.assembled_by != user.id:
        raise HTTPException(400, f"Сумку уже собирает {bag.assembled_by}")
    if bag.status not in ("free", "assembling"):
        raise HTTPException(400, f"Сумка занята (статус: {bag.status})")
    order = db.query(Order).filter(Order.id == data.order_id).first()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.status not in ("awaiting_assembly", "new", "assembling", "assembling_late"):
        raise HTTPException(400, f"Заказ нельзя собирать (статус: {order.status})")

    if bag.status == "free":
        bag.assembly_started_at = datetime.utcnow()
    bag.status = "assembling"
    bag.order_id = order.id
    bag.assembled_by = user.id
    bag.cutoff_minutes = order.cutoff_minutes or 10
    mark_late_if_needed(bag, order)
    order.bag_id = bag.id
    order.status = "assembling_late" if order.is_late else "assembling"
    log_op(db, "assembly_start", user.id, bag_id=bag.id, order_id=order.id)
    db.commit()
    left = None
    if bag.assembly_started_at:
        end = bag.assembly_started_at + timedelta(minutes=bag.cutoff_minutes)
        left = int((end - datetime.utcnow()).total_seconds() // 60)
    return {
        "ok": True, "bag_id": bag.id, "order_id": order.id,
        "cutoff_minutes": bag.cutoff_minutes, "cutoff_left": left,
        "is_late": bool(order.is_late), "late_minutes": order.late_minutes,
        "address": order.address, "object_info": order.object_info,
        "message": "Сборка начата" + (" (опоздание зафиксировано)" if order.is_late else ""),
    }

@app.post("/api/assembly/add-item")
def assembly_add_item(data: AssemblyItemIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    eq_id = normalize(data.equipment_id).lower()
    if not is_equipment(eq_id):
        raise HTTPException(400, "Неверный код оборудования")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag or bag.status != "assembling":
        raise HTTPException(400, "Сумка не в режиме сборки")
    if bag.assembled_by and bag.assembled_by != user.id and user.role != "admin":
        raise HTTPException(400, f"Сумку собирает {bag.assembled_by}")
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Оборудование не найдено")
    if eq.bag_id == bag.id:
        raise HTTPException(400, f"Уже в этой сумке: {eq.id}")
    if eq.status == "in_bag":
        raise HTTPException(400, f"Уже в другой сумке ({eq.bag_id})")
    if eq.status == "in_shipment":
        raise HTTPException(400, f"Уже в поставке ({eq.shipment_id})")
    if eq.status not in ("in_cell",):
        raise HTTPException(400, f"Повторный скан / нельзя: статус «{eq.status}»")
    order = db.query(Order).filter(Order.id == bag.order_id).first() if bag.order_id else None
    mark_late_if_needed(bag, order)
    eq.status = "in_bag"
    eq.bag_id = bag.id
    eq.cell_code = None
    touch_equipment(eq, user.id)
    log_op(db, "assembly_item", user.id, bag_id=bag.id, equipment_id=eq.id, order_id=bag.order_id)
    db.commit()
    items = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    return {"ok": True, "equipment_id": eq.id, "name": eq.name, "items_count": len(items),
            "items": [{"id": i.id, "name": i.name} for i in items],
            "is_late": bool(order.is_late) if order else False}

@app.post("/api/assembly/finish")
def assembly_finish(data: AssemblyFinishIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag or bag.status != "assembling":
        raise HTTPException(400, "Сумка не в режиме сборки")
    tp = normalize(data.transfer_point).upper()
    if not tp:
        raise HTTPException(400, "Укажите точку передачи")
    tp_row = db.query(TransferPoint).filter(TransferPoint.code == tp).first()
    if not tp_row and tp.startswith("TP"):
        raise HTTPException(400, f"Точка {tp} не найдена")
    tp_display = f"{tp_row.code} — {tp_row.name}" if tp_row else tp
    order = db.query(Order).filter(Order.id == bag.order_id).first() if bag.order_id else None
    mark_late_if_needed(bag, order)
    bag.status = "at_transfer"
    bag.transfer_point = tp_display
    bag.assembly_finished_at = datetime.utcnow()
    if order:
        order.status = "ready"
    log_op(db, "transfer", user.id, bag_id=bag.id, order_id=bag.order_id, comment=tp_display)
    db.commit()
    return {"ok": True, "message": f"Сумка {bag.id} на точке: {tp_display}", "status": "at_transfer"}

# ---------- issue ----------
@app.post("/api/issue")
def issue_bag(data: IssueIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    exec_id = normalize(data.executor_id).lower()
    bag_id = normalize(data.bag_id).lower()
    if not is_user(exec_id):
        raise HTTPException(400, "Код сотрудника: us + 6 цифр")
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки")
    executor = db.query(User).filter(User.id == exec_id).first()
    if not executor:
        raise HTTPException(404, "Исполнитель не найден")
    if executor.status == "blocked":
        raise HTTPException(403, "Сотрудник заблокирован. Передача сумки невозможна")
    if executor.status != "active":
        raise HTTPException(403, "Учётная запись неактивна")
    if executor.role not in ("cleaner", "handyman"):
        raise HTTPException(400, "Только клинер или мастер")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    if bag.status != "at_transfer":
        raise HTTPException(400, f"Сумка не на точке передачи ({bag.status})")
    bag.status = "in_use"
    bag.executor_id = exec_id
    bag.issued_at = datetime.utcnow()
    if bag.order_id:
        order = db.query(Order).filter(Order.id == bag.order_id).first()
        if order:
            order.status = "issued"
            order.executor_id = exec_id
    for eq in db.query(Equipment).filter(Equipment.bag_id == bag.id).all():
        eq.status = "issued"
        # касание исполнителя, не кладовщика
        touch_equipment(eq, exec_id)
    log_op(db, "issue_to_executor", user.id, bag_id=bag.id, order_id=bag.order_id, comment=exec_id)
    db.commit()
    return {"ok": True, "message": f"Сумка {bag.id} выдана {executor.full_name}",
            "executor": {"id": executor.id, "name": executor.full_name}}

# ---------- unpack ----------
@app.post("/api/unpack/start")
def unpack_start(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    bag_id = normalize(data.code).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    if bag.status not in ("in_use", "awaiting_unpack"):
        raise HTTPException(400, f"Нельзя разбирать ({bag.status})")
    bag.status = "awaiting_unpack"
    bag.returned_at = datetime.utcnow()
    items = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    db.commit()
    return {"ok": True, "bag_id": bag.id,
            "expected": [{"id": e.id, "name": e.name, "status": e.status} for e in items],
            "message": "Сканируйте оборудование, затем ячейку"}

@app.post("/api/unpack/item")
def unpack_item(data: UnpackItemIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    eq_id = normalize(data.equipment_id).lower()
    cell_code = normalize(data.cell_code)
    if not is_equipment(eq_id):
        raise HTTPException(400, "Неверный код оборудования")
    if not is_cell(cell_code):
        raise HTTPException(400, "Неверный код ячейки")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Оборудование не найдено")
    if eq.bag_id != bag.id:
        raise HTTPException(400, "Оборудование не из этой сумки")
    eq.status = "in_cell"
    eq.cell_code = cell_code
    eq.bag_id = None
    touch_equipment(eq, user.id)
    log_op(db, "unpack_item", user.id, bag_id=bag.id, equipment_id=eq.id, cell_code=cell_code)
    remaining = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    if not remaining:
        bag.status = "free"
        bag.order_id = None
        bag.executor_id = None
        bag.transfer_point = None
        bag.assembled_by = None
        bag.assembly_started_at = None
        bag.assembly_finished_at = None
    db.commit()
    return {"ok": True, "remaining": len(remaining),
            "remaining_items": [{"id": e.id, "name": e.name} for e in remaining],
            "bag_empty": len(remaining) == 0,
            "message": "Размещено" if remaining else "Сумка разобрана и свободна"}

@app.post("/api/unpack/damage")
def unpack_damage(data: DamageIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    if not is_problem_zone(data.zone_code):
        raise HTTPException(400, f"Отсканируйте зону {PROBLEM_ZONE}")
    eq_id = normalize(data.equipment_id).lower()
    bag_id = normalize(data.bag_id).lower()
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Не найдено")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    executor_id = bag.executor_id if bag else None
    if not executor_id and bag and bag.order_id:
        order = db.query(Order).filter(Order.id == bag.order_id).first()
        if order:
            executor_id = order.executor_id
    # last users: исполнитель, без склада
    lu1 = executor_id or (eq.last_user_1 if eq.last_user_1 != user.id else eq.last_user_2)
    lu2 = None
    if eq.last_user_1 and eq.last_user_1 != user.id and eq.last_user_1 != lu1:
        lu2 = eq.last_user_1
    elif eq.last_user_2 and eq.last_user_2 != user.id and eq.last_user_2 != lu1:
        lu2 = eq.last_user_2
    eq.status = "damaged"
    eq.bag_id = None
    eq.cell_code = PROBLEM_ZONE
    if lu1:
        eq.last_user_1 = lu1
        eq.last_user_2 = lu2
    db.add(MissingReport(
        equipment_id=eq.id, bag_id=bag_id, order_id=bag.order_id if bag else None,
        reported_by=user.id, last_user_1=lu1, last_user_2=lu2,
        kind="damaged", status="open",
    ))
    log_op(db, "damage", user.id, bag_id=bag_id, equipment_id=eq.id, comment=PROBLEM_ZONE)
    db.commit()
    return {"ok": True, "message": f"{eq.id} → повреждённые"}

@app.post("/api/unpack/declare-empty")
def declare_empty(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    bag_id = normalize(data.code).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    missing = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    if not missing and bag.status in ("awaiting_unpack", "in_use", "assembling"):
        bag.status = "free"
        bag.order_id = None
        bag.executor_id = None
        bag.transfer_point = None
        bag.assembled_by = None
        bag.assembly_started_at = None
        bag.assembly_finished_at = None
        log_op(db, "bag_free", user.id, bag_id=bag.id, comment="no missing after unpack")
        db.commit()
        return {
            "bag_id": bag.id,
            "missing": [],
            "has_missing": False,
            "bag_freed": True,
            "message": "Недостач нет. Сумка свободна",
        }
    return {
        "bag_id": bag.id,
        "missing": [{"id": e.id, "name": e.name, "last_user_1": e.last_user_1, "last_user_2": e.last_user_2} for e in missing],
        "has_missing": len(missing) > 0,
        "bag_freed": False,
    }

@app.post("/api/unpack/start-investigation")
def start_investigation(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    bag_id = normalize(data.code).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    missing = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    reports = []
    # для пропажи фиксируем исполнителя, не сотрудника склада
    executor_id = bag.executor_id
    if not executor_id and bag.order_id:
        order = db.query(Order).filter(Order.id == bag.order_id).first()
        if order:
            executor_id = order.executor_id
    for eq in missing:
        # кто касался до склада (без кладовщика)
        u1, u2 = eq.last_user_1, eq.last_user_2
        def _is_wh(uid):
            if not uid:
                return True
            uu = db.query(User).filter(User.id == uid).first()
            return not uu or uu.role in ("supervisor", "admin", "warehouse")
        # оставляем только исполнителей / мастеров
        chain = [x for x in [u1, u2, executor_id] if x and not _is_wh(x)]
        # уникальные с сохранением порядка
        seen = set()
        chain_f = []
        for x in chain:
            if x not in seen:
                seen.add(x)
                chain_f.append(x)
        if executor_id and executor_id not in seen:
            chain_f.insert(0, executor_id)
        lu1 = chain_f[0] if chain_f else executor_id
        lu2 = chain_f[1] if len(chain_f) > 1 else None
        eq.status = "missing"
        eq.bag_id = None
        # не пишем склад в last_user
        if lu1:
            eq.last_user_1 = lu1
            eq.last_user_2 = lu2
        db.add(MissingReport(
            equipment_id=eq.id, bag_id=bag.id, order_id=bag.order_id,
            reported_by=user.id, last_user_1=lu1, last_user_2=lu2,
            kind="missing", status="open",
        ))
        reports.append(eq.id)
        log_op(db, "missing", user.id, bag_id=bag.id, equipment_id=eq.id, comment=f"executor:{lu1}")
    bag.status = "free"
    bag.order_id = None
    bag.executor_id = None
    bag.assembled_by = None
    bag.transfer_point = None
    bag.assembly_started_at = None
    db.commit()
    return {"ok": True, "missing_ids": reports, "message": "Расследование запущено. Сумка свободна."}

# ---------- receive ----------
@app.post("/api/equipment-types")
def add_ean(data: EanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    ean = normalize(data.ean)
    if db.query(EquipmentType).filter(EquipmentType.ean == ean).first():
        raise HTTPException(400, "EAN уже есть")
    t = EquipmentType(ean=ean, name=data.name, category=data.category)
    db.add(t)
    db.commit()
    return {"ean": t.ean, "name": t.name}

@app.get("/api/equipment-types")
def list_eans(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    result = []
    for t in db.query(EquipmentType).all():
        units = db.query(Equipment).filter(Equipment.ean == t.ean, Equipment.status != "written_off").all()
        cells = {}
        for e in units:
            key = e.cell_code or e.status
            cells.setdefault(key, []).append({"id": e.id, "name": e.name, "status": e.status})
        result.append({
            "ean": t.ean, "name": t.name, "category": t.category,
            "count": len(units),
            "cells": cells,
        })
    return result

@app.delete("/api/equipment-types/{ean}")
def delete_ean(ean: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    t = db.query(EquipmentType).filter(EquipmentType.ean == ean).first()
    if not t:
        raise HTTPException(404, "EAN не найден")
    cnt = db.query(Equipment).filter(Equipment.ean == ean, Equipment.status != "written_off").count()
    if cnt:
        raise HTTPException(400, f"Есть {cnt} единиц на учёте. Сначала спишите или переместите.")
    db.delete(t)
    db.commit()
    return {"ok": True}

@app.post("/api/receive")
def receive_unit(data: ReceiveIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    ean = normalize(data.ean)
    eq_id = normalize(data.equipment_id).lower()
    if not is_equipment(eq_id):
        raise HTTPException(400, "Код: dd + 8 цифр")
    t = db.query(EquipmentType).filter(EquipmentType.ean == ean).first()
    if not t:
        raise HTTPException(404, "EAN не найден")
    existing = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if existing and existing.status not in ("written_off", "missing"):
        raise HTTPException(400, "Код единицы уже используется")
    if existing:
        existing.ean = ean
        existing.name = t.name
        existing.status = "receiving"
        existing.cell_code = None
        existing.bag_id = None
        touch_equipment(existing, user.id)
        eq = existing
        log_op(db, "receive_reuse", user.id, equipment_id=eq.id, comment=f"reuse {ean}")
        msg = "Код переиспользован (был списан/пропажа). Отсканируйте ячейку"
    else:
        eq = Equipment(id=eq_id, ean=ean, name=t.name, status="receiving")
        touch_equipment(eq, user.id)
        db.add(eq)
        log_op(db, "receive", user.id, equipment_id=eq.id, comment=ean)
        msg = "Принято. Отсканируйте ячейку"
    db.commit()
    return {"ok": True, "equipment_id": eq.id, "name": eq.name, "message": msg}

@app.post("/api/receive/place")
def receive_place(data: PlaceIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    eq_id = normalize(data.equipment_id).lower()
    cell_code = normalize(data.cell_code)
    if not is_cell(cell_code):
        raise HTTPException(400, "Неверный код ячейки")
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Не найдено")
    eq.status = "in_cell"
    eq.cell_code = cell_code
    touch_equipment(eq, user.id)
    log_op(db, "place_cell", user.id, equipment_id=eq.id, cell_code=cell_code)
    db.commit()
    return {"ok": True, "message": f"{eq.id} → {cell_code}"}

# ---------- missing / writeoff ----------
@app.get("/api/missing")
def list_missing(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor"))):
    rows = db.query(MissingReport).filter(MissingReport.status == "open").order_by(MissingReport.created_at.desc()).all()
    result = []
    for r in rows:
        eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
        result.append({
            "id": r.id, "equipment_id": r.equipment_id,
            "name": eq.name if eq else r.equipment_id,
            "bag_id": r.bag_id, "order_id": r.order_id,
            "last_user_1": r.last_user_1, "last_user_2": r.last_user_2,
            "reported_by": r.reported_by, "kind": getattr(r, "kind", None) or "missing",
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return result

@app.post("/api/missing/write-off")
def write_off(data: MissingActionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    r = db.query(MissingReport).filter(MissingReport.id == data.report_id).first()
    if not r or r.status != "open":
        raise HTTPException(404, "Запись не найдена")
    eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
    if eq:
        eq.status = "written_off"
        eq.cell_code = None
        eq.bag_id = None
    r.status = "written_off"
    log_op(db, "write_off", user.id, equipment_id=r.equipment_id, comment=f"report:{r.id}")
    db.commit()
    return {"ok": True, "message": "Списано"}

@app.post("/api/missing/restore")
def restore_missing(data: MissingActionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    r = db.query(MissingReport).filter(MissingReport.id == data.report_id).first()
    if not r or r.status != "open":
        raise HTTPException(404, "Запись не найдена")
    cell = data.cell_code or "DY0010661/2"
    if not is_cell(cell):
        raise HTTPException(400, "Укажите ячейку для возврата")
    eq = db.query(Equipment).filter(Equipment.id == r.equipment_id).first()
    if eq:
        eq.status = "in_cell"
        eq.cell_code = cell
        eq.bag_id = None
        touch_equipment(eq, user.id)
    r.status = "restored"
    log_op(db, "restore", user.id, equipment_id=r.equipment_id, cell_code=cell)
    db.commit()
    return {"ok": True, "message": f"Возвращено на учёт в {cell}"}

# ---------- orders ----------
def _next_order_id(db: Session) -> str:
    last = db.query(Order).order_by(Order.id.desc()).first()
    n = 1
    if last and last.id.startswith("ORD"):
        try:
            n = int(last.id.replace("ORD", "")) + 1
        except ValueError:
            n = 1
    return f"ORD{n:05d}"

@app.post("/api/orders")
def create_order(data: OrderCreateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if not data.address or not data.address.strip():
        raise HTTPException(400, "Укажите адрес")
    if data.executor_id:
        ex = db.query(User).filter(User.id == normalize(data.executor_id).lower()).first()
        if not ex or ex.role not in ("cleaner", "handyman"):
            raise HTTPException(400, "Исполнитель: клинер или мастер")
    oid = _next_order_id(db)
    status = "awaiting_assembly" if data.send_to_assembly else "new"
    order = Order(
        id=oid, client_name=data.client_name, address=data.address.strip(),
        cleaning_type=data.cleaning_type, object_info=data.object_info,
        executor_id=normalize(data.executor_id).lower() if data.executor_id else None,
        status=status, cutoff_minutes=data.cutoff_minutes or 10,
        signal_sent=bool(data.send_to_assembly), created_at=datetime.utcnow(),
    )
    db.add(order)
    log_op(db, "order_created", user.id, order_id=oid)
    db.commit()
    return {"id": order.id, "status": order.status, "signal": order.signal_sent,
            "message": f"Заказ {order.id} " + ("на сборку" if data.send_to_assembly else "создан")}

@app.post("/api/orders/{order_id}/send-to-assembly")
def send_to_assembly(order_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Не найден")
    if order.status not in ("new", "cancelled"):
        raise HTTPException(400, f"Нельзя ({order.status})")
    order.status = "awaiting_assembly"
    order.signal_sent = True
    log_op(db, "send_to_assembly", user.id, order_id=order.id)
    db.commit()
    return {"ok": True, "message": f"{order.id} на сборке", "signal": True}

@app.post("/api/orders/{order_id}/request-complete")
def request_complete(order_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Не найден")
    if user.role in ("cleaner", "handyman") and order.executor_id != user.id:
        raise HTTPException(403, "Не ваш заказ")
    if order.status != "issued":
        raise HTTPException(400, "Заказ не на исполнении")
    order.status = "completion_pending"
    order.completion_requested_at = datetime.utcnow()
    log_op(db, "complete_request", user.id, order_id=order.id)
    db.commit()
    return {"ok": True, "message": "Запрос на завершение отправлен админу"}

@app.post("/api/orders/{order_id}/confirm-complete")
def confirm_complete(order_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Не найден")
    if order.status != "completion_pending":
        raise HTTPException(400, "Нет запроса на завершение")
    order.status = "done"
    order.completed_at = datetime.utcnow()
    order.completed_by = user.id
    log_op(db, "complete_confirm", user.id, order_id=order.id)
    db.commit()
    return {"ok": True, "message": f"Заказ {order.id} завершён"}

@app.post("/api/orders/{order_id}/reassign")
def reassign_order(order_id: str, data: ReassignIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Не найден")
    eid = normalize(data.executor_id).lower()
    ex = db.query(User).filter(User.id == eid).first()
    if not ex or ex.role not in ("cleaner", "handyman") or ex.status != "active":
        raise HTTPException(400, "Некорректный исполнитель")
    old = order.executor_id
    order.executor_id = eid
    if order.bag_id:
        bag = db.query(Bag).filter(Bag.id == order.bag_id).first()
        if bag and bag.status == "in_use":
            bag.executor_id = eid
    log_op(db, "reassign", user.id, order_id=order.id, comment=f"{old}->{eid}")
    db.commit()
    return {"ok": True, "message": f"Исполнитель: {ex.full_name}"}

@app.get("/api/orders")
def list_orders(scope: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # purge done orders older than 3 months
    cutoff = datetime.utcnow() - timedelta(days=90)
    old_done = db.query(Order).filter(Order.status == "done", Order.completed_at != None, Order.completed_at < cutoff).all()
    for o in old_done:
        db.delete(o)
    if old_done:
        db.commit()

    q = db.query(Order).order_by(Order.created_at.desc())
    if user.role in ("cleaner", "handyman"):
        q = q.filter(Order.executor_id == user.id)
        if scope == "history":
            # current month completed
            now = datetime.utcnow()
            start = datetime(now.year, now.month, 1)
            q = q.filter(Order.status == "done", Order.completed_at >= start)
        else:
            q = q.filter(Order.status != "done")
    else:
        if scope == "history":
            q = q.filter(Order.status == "done")
        elif scope == "active":
            q = q.filter(Order.status != "done")
    result = []
    for o in q.all():
        bag = db.query(Bag).filter(Bag.id == o.bag_id).first() if o.bag_id else None
        result.append({
            "id": o.id, "address": o.address, "status": o.status,
            "status_label": ORDER_LABELS.get(o.status, o.status),
            "executor_id": o.executor_id, "bag_id": o.bag_id,
            "cutoff_minutes": o.cutoff_minutes, "client_name": o.client_name,
            "cleaning_type": o.cleaning_type, "object_info": o.object_info,
            "is_late": bool(o.is_late), "late_minutes": o.late_minutes,
            "bag_status": bag.status if bag else None,
            "transfer_point": bag.transfer_point if bag else None,
            "completed_at": o.completed_at.isoformat() if o.completed_at else None,
            "completed_by": o.completed_by,
            "created_at": o.created_at.isoformat() if o.created_at else None,
        })
    return result


@app.get("/api/orders/{order_id}/history")
def order_history(order_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ops = db.query(Operation).filter(Operation.order_id == order_id).order_by(Operation.datetime).all()
    return [{"type": o.type, "user_id": o.user_id, "comment": o.comment,
             "datetime": o.datetime.isoformat() if o.datetime else None,
             "bag_id": o.bag_id, "equipment_id": o.equipment_id} for o in ops]

@app.get("/api/transfer-points")
def list_tp(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    return [{"code": t.code, "name": t.name} for t in db.query(TransferPoint).order_by(TransferPoint.code).all()]

@app.post("/api/transfer-points")
def add_tp(data: TransferPointIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    code = normalize(data.code).upper()
    if not code.startswith("TP"):
        raise HTTPException(400, "Код: TP01 …")
    if db.query(TransferPoint).filter(TransferPoint.code == code).first():
        raise HTTPException(400, "Уже есть")
    tp = TransferPoint(code=code, name=data.name)
    db.add(tp)
    db.commit()
    return {"code": tp.code, "name": tp.name}

@app.patch("/api/transfer-points/{code}")
def edit_tp(code: str, data: TransferPointUpdateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    tp = db.query(TransferPoint).filter(TransferPoint.code == code.upper()).first()
    if not tp:
        raise HTTPException(404, "Не найдена")
    tp.name = data.name
    db.commit()
    return {"code": tp.code, "name": tp.name}

@app.delete("/api/transfer-points/{code}")
def del_tp(code: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    tp = db.query(TransferPoint).filter(TransferPoint.code == code.upper()).first()
    if not tp:
        raise HTTPException(404, "Не найдена")
    db.delete(tp)
    db.commit()
    return {"ok": True}

@app.post("/api/bags/return")
def return_bag(data: ReturnBagIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    bag_id = normalize(data.bag_id).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки")
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Не найдена")
    if bag.status != "in_use":
        raise HTTPException(400, f"Не у исполнителя ({bag.status})")
    bag.status = "awaiting_unpack"
    bag.returned_at = datetime.utcnow()
    log_op(db, "bag_return", user.id, bag_id=bag.id, order_id=bag.order_id)
    db.commit()
    return {"ok": True, "message": f"Сумка {bag.id} ждёт разбор", "status": "awaiting_unpack"}



@app.post("/api/bags")
def create_bag(data: BagCreateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    bag_id = normalize(data.bag_id).lower()
    if not is_bag(bag_id):
        raise HTTPException(400, "Формат: sumka + 5 цифр")
    if db.query(Bag).filter(Bag.id == bag_id).first():
        raise HTTPException(400, "Сумка уже есть")
    db.add(Bag(id=bag_id, status="free"))
    log_op(db, "bag_create", user.id, bag_id=bag_id)
    db.commit()
    return {"ok": True, "id": bag_id}

@app.delete("/api/bags/{bag_id}")
def delete_bag(bag_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    bag_id = normalize(bag_id).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Не найдена")
    if bag.status != "free":
        raise HTTPException(400, f"Можно удалить только свободную сумку (сейчас: {bag.status})")
    left = db.query(Equipment).filter(Equipment.bag_id == bag.id).count()
    if left:
        raise HTTPException(400, "В сумке ещё есть оборудование")
    db.delete(bag)
    log_op(db, "bag_delete", user.id, bag_id=bag_id)
    db.commit()
    return {"ok": True}

@app.post("/api/admin/password")
def admin_change_password(data: PasswordChangeIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if not data.new_password or len(data.new_password) < 4:
        raise HTTPException(400, "Пароль минимум 4 символа")
    if data.old_password and not verify_password(data.old_password, user.password_hash):
        raise HTTPException(400, "Старый пароль неверен")
    log_user_change(db, user.id, user.id, "password", "***", "***")
    user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"ok": True, "message": "Пароль изменён"}

@app.post("/api/admin/profile")
def admin_update_self(data: AdminSelfIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if data.full_name:
        log_user_change(db, user.id, user.id, "full_name", user.full_name, data.full_name)
        user.full_name = data.full_name
    if data.password:
        if len(data.password) < 4:
            raise HTTPException(400, "Пароль минимум 4 символа")
        log_user_change(db, user.id, user.id, "password", "***", "***")
        user.password_hash = hash_password(data.password)
    db.commit()
    return {"ok": True, "full_name": user.full_name}

@app.post("/api/bags/{bag_id}/force-free")
def force_free_bag(bag_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    """Сброс зависшей сумки: оборудование возвращается на склад (первая ячейка), заказ снова ждёт сборки."""
    bag_id = normalize(bag_id).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")

    items = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    # ячейка по умолчанию для возврата
    default_cell = db.query(Cell).order_by(Cell.code).first()
    default_code = default_cell.code if default_cell else "DY0010661/2"

    returned = []
    for eq in items:
        eq.bag_id = None
        eq.status = "in_cell"
        eq.cell_code = default_code
        returned.append(eq.id)
        log_op(db, "bag_force_return", user.id, bag_id=bag.id, equipment_id=eq.id, cell_code=default_code)

    order_id = bag.order_id
    if order_id:
        order = db.query(Order).filter(Order.id == order_id).first()
        if order and order.status in ("assembling", "assembling_late", "ready", "issued"):
            order.status = "awaiting_assembly"
            order.bag_id = None
            log_op(db, "assembly_cancelled", user.id, order_id=order.id, bag_id=bag.id)

    bag.status = "free"
    bag.order_id = None
    bag.executor_id = None
    bag.transfer_point = None
    bag.assembled_by = None
    bag.assembly_started_at = None
    bag.assembly_finished_at = None
    bag.issued_at = None
    log_op(db, "bag_force_free", user.id, bag_id=bag.id, comment=f"returned:{len(returned)}")
    db.commit()
    msg = f"Сумка {bag.id} свободна"
    if returned:
        msg += f". Оборудование ({len(returned)} шт) → {default_code}"
    if order_id:
        msg += f". Заказ {order_id} снова ожидает сборки"
    return {"ok": True, "message": msg, "returned": returned, "cell": default_code}

@app.get("/api/tsd/signals")
def tsd_signals(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    orders = db.query(Order).filter(Order.status == "awaiting_assembly", Order.signal_sent == True).order_by(Order.created_at.desc()).limit(20).all()
    return [{"order_id": o.id, "address": o.address, "cutoff_minutes": o.cutoff_minutes,
             "executor_id": o.executor_id, "beep": True} for o in orders]

@app.get("/api/equipment")
def list_equipment(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    return [{"id": e.id, "name": e.name, "status": e.status, "cell_code": e.cell_code,
             "bag_id": e.bag_id, "ean": e.ean, "last_user_1": e.last_user_1, "last_user_2": e.last_user_2}
            for e in db.query(Equipment).order_by(Equipment.id).all()]


@app.get("/api/lookup")
def lookup(code: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Универсальная информация по объекту (как в Ozon WMS): что это и где сейчас."""
    raw = normalize(code)
    c = raw.lower()
    result = {"code": raw, "kind": None, "title": None, "location": None, "status": None, "details": {}}

    # --- bag ---
    if is_bag(c):
        bag = db.query(Bag).filter(Bag.id == c).first()
        if not bag:
            raise HTTPException(404, "Сумка не найдена в системе")
        labels = {
            "free": "Свободна", "assembling": "Собирается", "at_transfer": "На точке передачи",
            "in_use": "У исполнителя", "awaiting_unpack": "Ждёт разбор",
        }
        items = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
        order = db.query(Order).filter(Order.id == bag.order_id).first() if bag.order_id else None
        loc_parts = []
        if bag.status == "free":
            loc_parts.append("на складе (свободна)")
        elif bag.status == "assembling":
            loc_parts.append(f"сборка, сборщик {bag.assembled_by or '—'}")
        elif bag.status == "at_transfer":
            loc_parts.append(f"точка передачи: {bag.transfer_point or '—'}")
        elif bag.status == "in_use":
            ex = db.query(User).filter(User.id == bag.executor_id).first() if bag.executor_id else None
            loc_parts.append(f"у исполнителя {bag.executor_id or '—'}" + (f" ({ex.full_name})" if ex else ""))
        elif bag.status == "awaiting_unpack":
            loc_parts.append("принята, ждёт разбор на складе")
        result.update({
            "kind": "bag",
            "title": f"Сумка {bag.id}",
            "status": labels.get(bag.status, bag.status),
            "location": "; ".join(loc_parts) if loc_parts else bag.status,
            "details": {
                "order_id": bag.order_id,
                "address": order.address if order else None,
                "object_info": order.object_info if order else None,
                "executor_id": bag.executor_id,
                "assembled_by": bag.assembled_by,
                "transfer_point": bag.transfer_point,
                "items_count": len(items),
                "items": [{"id": e.id, "name": e.name, "status": e.status} for e in items],
            },
        })
        return result

    # --- equipment unit ---
    if is_equipment(c):
        eq = db.query(Equipment).filter(Equipment.id == c).first()
        if not eq:
            raise HTTPException(404, "Оборудование не найдено")
        status_labels = {
            "in_cell": "В ячейке", "in_bag": "В сумке", "issued": "Выдано исполнителю",
            "damaged": "Повреждено", "missing": "Пропажа", "receiving": "Приёмка",
            "written_off": "Списано",
        }
        loc = None
        if eq.status == "in_cell" and eq.cell_code:
            loc = f"ячейка {eq.cell_code}"
        elif eq.bag_id:
            bag = db.query(Bag).filter(Bag.id == eq.bag_id).first()
            if bag and bag.status == "in_use" and bag.executor_id:
                loc = f"сумка {eq.bag_id} у исполнителя {bag.executor_id}"
            elif bag and bag.status == "at_transfer":
                loc = f"сумка {eq.bag_id} на точке {bag.transfer_point or 'передачи'}"
            elif bag and bag.status == "assembling":
                loc = f"сумка {eq.bag_id} (сборка, {bag.assembled_by or '—'})"
            elif bag and bag.status == "awaiting_unpack":
                loc = f"сумка {eq.bag_id} (ждёт разбор)"
            else:
                loc = f"сумка {eq.bag_id}"
        elif eq.status == "damaged":
            loc = f"зона повреждений ({eq.cell_code or 'PROBLEMNOE_OBORUDOVANIE'})"
        elif eq.status == "missing":
            loc = "пропажа (см. раздел Пропажи)"
        elif eq.status == "written_off":
            loc = "списано с учёта"
        result.update({
            "kind": "equipment",
            "title": eq.name or eq.id,
            "status": status_labels.get(eq.status, eq.status),
            "location": loc or eq.status,
            "details": {
                "id": eq.id,
                "ean": eq.ean,
                "cell_code": eq.cell_code,
                "bag_id": eq.bag_id,
                "last_user_1": eq.last_user_1,
                "last_user_2": eq.last_user_2,
            },
        })
        return result

    # --- cell ---
    if is_cell(raw) or is_cell(c.upper() if c.startswith("dy") else raw):
        code = raw if is_cell(raw) else ("DY" + raw[2:] if raw[:2].lower() == "dy" else raw)
        # try normalized
        parsed = parse_cell(raw)
        cell_code = None
        if parsed:
            # find exact
            for cell in db.query(Cell).all():
                if cell.code.upper() == raw.upper() or cell.code == parsed.get("code"):
                    cell_code = cell.code
                    break
            if not cell_code:
                cell_code = raw.upper().replace("DY", "DY") if raw.upper().startswith("DY") else raw
        else:
            cell_code = raw
        cell = db.query(Cell).filter(Cell.code == cell_code).first()
        if not cell:
            # try case-insensitive
            cell = db.query(Cell).filter(Cell.code.ilike(cell_code)).first()
        if not cell:
            raise HTTPException(404, "Ячейка не найдена")
        items = db.query(Equipment).filter(Equipment.cell_code == cell.code, Equipment.status == "in_cell").all()
        result.update({
            "kind": "cell",
            "title": f"Ячейка {cell.code}",
            "status": f"{len(items)} ед. на месте",
            "location": f"склад {cell.warehouse_no}, регион {cell.region}, полка {cell.shelf}/{cell.slot}",
            "details": {
                "code": cell.code,
                "items": [{"id": e.id, "name": e.name, "ean": e.ean} for e in items],
            },
        })
        return result

    # --- user ---
    if is_user(c):
        u = db.query(User).filter(User.id == c).first()
        if not u:
            raise HTTPException(404, "Сотрудник не найден")
        bags = db.query(Bag).filter(Bag.executor_id == u.id, Bag.status == "in_use").all()
        result.update({
            "kind": "user",
            "title": u.full_name,
            "status": ROLE_LABELS.get(u.role, u.role) + f" · {u.status}",
            "location": f"учётная запись {u.id}",
            "details": {
                "id": u.id,
                "role": u.role,
                "bags_in_use": [{"id": b.id, "order_id": b.order_id} for b in bags],
            },
        })
        return result

    # --- EAN / equipment type ---
    if is_ean(raw) or db.query(EquipmentType).filter(EquipmentType.ean == raw).first():
        trow = db.query(EquipmentType).filter(EquipmentType.ean == raw).first()
        if not trow:
            raise HTTPException(404, "EAN не найден")
        units = db.query(Equipment).filter(Equipment.ean == trow.ean, Equipment.status != "written_off").all()
        by_loc = {}
        for e in units:
            key = e.cell_code or (f"сумка {e.bag_id}" if e.bag_id else e.status)
            by_loc.setdefault(key, []).append(e.id)
        result.update({
            "kind": "ean",
            "title": trow.name,
            "status": f"{len(units)} ед. на учёте",
            "location": "см. размещение по ячейкам/сумкам",
            "details": {
                "ean": trow.ean,
                "category": trow.category,
                "placement": {k: v for k, v in by_loc.items()},
            },
        })
        return result

    # --- transfer point ---
    cu = raw.upper()
    tp = db.query(TransferPoint).filter(TransferPoint.code == cu).first()
    if tp:
        bags = db.query(Bag).filter(Bag.status == "at_transfer", Bag.transfer_point.contains(tp.code)).all()
        result.update({
            "kind": "transfer_point",
            "title": f"{tp.code} — {tp.name}",
            "status": f"сумок на точке: {len(bags)}",
            "location": tp.name,
            "details": {"bags": [b.id for b in bags]},
        })
        return result

    # --- order ---
    if c.upper().startswith("ORD") or c.startswith("ord"):
        oid = raw.upper() if raw.upper().startswith("ORD") else raw
        order = db.query(Order).filter(Order.id == oid).first()
        if not order:
            order = db.query(Order).filter(Order.id.ilike(oid)).first()
        if order:
            bag = db.query(Bag).filter(Bag.id == order.bag_id).first() if order.bag_id else None
            result.update({
                "kind": "order",
                "title": order.address,
                "status": ORDER_LABELS.get(order.status, order.status),
                "location": (f"сумка {order.bag_id}" if order.bag_id else "сумка не назначена")
                    + (f", исполнитель {order.executor_id}" if order.executor_id else ""),
                "details": {
                    "id": order.id,
                    "client_name": order.client_name,
                    "object_info": order.object_info,
                    "bag_id": order.bag_id,
                    "bag_status": bag.status if bag else None,
                    "executor_id": order.executor_id,
                    "is_late": bool(order.is_late),
                },
            })
            return result

    raise HTTPException(404, "Код не распознан. Сканируйте dd… / sumka… / DY… / us… / EAN / TP… / ORD…")


# ---------- warehouses ----------

@app.get("/api/warehouses/stock")
def warehouses_stock(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    """Сводка: по каждому складу сколько единиц и список dd."""
    whs = db.query(Warehouse).order_by(Warehouse.code).all()
    result = []
    for w in whs:
        # оборудование на складе: warehouse_code совпадает ИЛИ ячейка DY{code}...
        eqs = db.query(Equipment).filter(
            Equipment.status.in_(["in_cell", "in_bag", "receiving", "in_shipment"])
        ).all()
        items = []
        for e in eqs:
            code = (e.warehouse_code or "")
            if not code and e.cell_code and e.cell_code.startswith("DY") and len(e.cell_code) >= 8:
                code = e.cell_code[2:8]
            if code == w.code:
                items.append({
                    "id": e.id, "name": e.name, "status": e.status,
                    "cell_code": e.cell_code, "bag_id": e.bag_id,
                })
        result.append({
            "code": w.code, "name": w.name, "count": len(items), "items": items,
        })
    # единицы без склада
    orphan = []
    known = {w.code for w in whs}
    for e in db.query(Equipment).filter(Equipment.status.in_(["in_cell", "in_bag", "receiving", "in_shipment"])).all():
        code = (e.warehouse_code or "")
        if not code and e.cell_code and e.cell_code.startswith("DY") and len(e.cell_code) >= 8:
            code = e.cell_code[2:8]
        if code not in known:
            orphan.append({"id": e.id, "name": e.name, "status": e.status, "cell_code": e.cell_code})
    if orphan:
        result.append({"code": "—", "name": "Без склада", "count": len(orphan), "items": orphan})
    return result


@app.get("/api/warehouses")
def list_warehouses(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(Warehouse).order_by(Warehouse.code).all()
    return [{"code": w.code, "name": w.name, "is_main": bool(w.is_main)} for w in rows]

@app.post("/api/warehouses")
def create_warehouse(data: WarehouseIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    code = normalize(data.code)
    if not is_warehouse_code(code):
        raise HTTPException(400, "Код склада: 6 цифр, например 001066")
    if db.query(Warehouse).filter(Warehouse.code == code).first():
        raise HTTPException(400, "Склад уже есть")
    w = Warehouse(code=code, name=data.name.strip() or code, is_main=data.is_main)
    db.add(w)
    log_op(db, "warehouse_create", user.id, comment=code)
    db.commit()
    return {"code": w.code, "name": w.name}

@app.delete("/api/warehouses/{code}")
def delete_warehouse(code: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    code = normalize(code)
    w = db.query(Warehouse).filter(Warehouse.code == code).first()
    if not w:
        raise HTTPException(404, "Не найден")
    db.delete(w)
    db.commit()
    return {"ok": True}

# ---------- shift ----------
@app.get("/api/shift/today")
def shift_today(warehouse_code: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    wh = normalize(warehouse_code)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    rows = db.query(ShiftEntry).filter(ShiftEntry.warehouse_code == wh, ShiftEntry.shift_date == today).all()
    result = []
    for r in rows:
        u = db.query(User).filter(User.id == r.user_id).first()
        if u:
            result.append({
                "user_id": u.id, "full_name": u.full_name, "role": u.role,
                "role_label": ROLE_LABELS.get(u.role, u.role),
                "status": u.status,
            })
    return result

@app.post("/api/shift/mark")
def shift_mark(data: ShiftMarkIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor"))):
    uid = normalize(data.user_id).lower()
    wh = normalize(data.warehouse_code)
    if not is_warehouse_code(wh):
        raise HTTPException(400, "Код склада: 6 цифр")
    u = db.query(User).filter(User.id == uid).first()
    if not u or u.status != "active":
        raise HTTPException(404, "Сотрудник не найден или неактивен")
    today = datetime.utcnow().strftime("%Y-%m-%d")
    exists = db.query(ShiftEntry).filter(
        ShiftEntry.warehouse_code == wh, ShiftEntry.user_id == uid, ShiftEntry.shift_date == today
    ).first()
    if exists:
        return {"ok": True, "message": f"{u.full_name} уже на смене", "user_id": uid}
    db.add(ShiftEntry(warehouse_code=wh, user_id=uid, shift_date=today, marked_by=user.id))
    log_op(db, "shift_mark", user.id, comment=f"{uid}@{wh}")
    db.commit()
    return {"ok": True, "message": f"{u.full_name} на смене", "user_id": uid, "full_name": u.full_name}

@app.delete("/api/shift/mark")
def shift_unmark(user_id: str, warehouse_code: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor"))):
    uid = normalize(user_id).lower()
    wh = normalize(warehouse_code)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    row = db.query(ShiftEntry).filter(
        ShiftEntry.warehouse_code == wh, ShiftEntry.user_id == uid, ShiftEntry.shift_date == today
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}

@app.get("/api/shift/executors")
def shift_executors(warehouse_code: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Исполнители на смене — для выбора в заказе."""
    wh = normalize(warehouse_code)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    rows = db.query(ShiftEntry).filter(ShiftEntry.warehouse_code == wh, ShiftEntry.shift_date == today).all()
    result = []
    for r in rows:
        u = db.query(User).filter(User.id == r.user_id, User.role.in_(["cleaner", "handyman"]), User.status == "active").first()
        if u:
            result.append({"id": u.id, "full_name": u.full_name, "role": u.role, "role_label": ROLE_LABELS.get(u.role, u.role)})
    # если смена пустая — fallback все клинеры (чтобы не блокировать)
    if not result:
        for u in db.query(User).filter(User.role.in_(["cleaner", "handyman"]), User.status == "active").all():
            result.append({"id": u.id, "full_name": u.full_name, "role": u.role, "role_label": ROLE_LABELS.get(u.role, u.role)})
    return result

# ---------- logistics / shipments ----------
SHIPMENT_LABELS = {
    "forming": "Формируется",
    "sent": "Отправлено",
    "receiving": "На приёмке",
    "received": "Принято",
    "received_shortage": "Принято с недостачей",
    "cancelled": "Отменено",
}

@app.get("/api/logistics/forming")
def logistics_forming(warehouse_code: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    wh = normalize(warehouse_code)
    rows = db.query(Shipment).filter(
        Shipment.from_warehouse == wh, Shipment.status == "forming"
    ).order_by(Shipment.created_at.desc()).all()
    result = []
    for s in rows:
        cnt = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == s.id).count()
        result.append({
            "id": s.id, "to_warehouse": s.to_warehouse, "from_warehouse": s.from_warehouse,
            "status": s.status, "status_label": SHIPMENT_LABELS.get(s.status, s.status),
            "assembler_id": s.assembler_id, "items_count": cnt, "kind": s.kind,
        })
    return result

@app.get("/api/logistics/history")
def logistics_history(warehouse_code: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor"))):
    # 3 months
    since = datetime.utcnow() - timedelta(days=90)
    q = db.query(Shipment).filter(Shipment.created_at >= since).order_by(Shipment.created_at.desc())
    if warehouse_code:
        wh = normalize(warehouse_code)
        q = q.filter((Shipment.from_warehouse == wh) | (Shipment.to_warehouse == wh))
    result = []
    for s in q.limit(200).all():
        cnt = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == s.id).count()
        missing_cnt = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == s.id, ShipmentItem.status == "missing").count()
        result.append({
            "id": s.id, "from_warehouse": s.from_warehouse, "to_warehouse": s.to_warehouse,
            "status": s.status, "status_label": SHIPMENT_LABELS.get(s.status, s.status),
            "items_count": cnt, "missing_count": missing_cnt, "kind": s.kind,
            "season": s.season, "season_year": s.season_year,
            "assembler_id": s.assembler_id, "created_by": s.created_by,
            "sent_at": s.sent_at.isoformat() if s.sent_at else None,
            "received_at": s.received_at.isoformat() if s.received_at else None,
            "shortage_json": s.shortage_json, "shortage_visualized": bool(s.shortage_visualized),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })
    return result

@app.get("/api/logistics/track/{shipment_id}")
def logistics_track(shipment_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sid = normalize(shipment_id)
    s = db.query(Shipment).filter(Shipment.id == sid).first()
    if not s:
        raise HTTPException(404, "Поставка не найдена")
    items = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == s.id).all()
    return {
        "id": s.id, "from_warehouse": s.from_warehouse, "to_warehouse": s.to_warehouse,
        "status": s.status, "status_label": SHIPMENT_LABELS.get(s.status, s.status),
        "kind": s.kind, "assembler_id": s.assembler_id,
        "items": [{"equipment_id": i.equipment_id, "name": i.name, "ean": i.ean, "status": i.status,
                   "received_cell": i.received_cell} for i in items],
        "items_count": len(items),
        "sent_at": s.sent_at.isoformat() if s.sent_at else None,
        "received_at": s.received_at.isoformat() if s.received_at else None,
        "shortage_json": s.shortage_json,
    }

@app.post("/api/logistics/shipments")
def create_shipment(data: ShipmentCreateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    sid = normalize(data.shipment_id)
    if not is_shipment_id(sid):
        raise HTTPException(400, "Номер поставки: 11 цифр")
    if db.query(Shipment).filter(Shipment.id == sid).first():
        raise HTTPException(400, "Поставка с таким номером уже есть")
    fw = normalize(data.from_warehouse)
    tw = normalize(data.to_warehouse)
    if not is_warehouse_code(fw) or not is_warehouse_code(tw):
        raise HTTPException(400, "Коды складов: 6 цифр")
    if fw == tw:
        raise HTTPException(400, "Склады отправки и назначения должны отличаться")
    if not db.query(Warehouse).filter(Warehouse.code == fw).first():
        raise HTTPException(400, f"Склад отправки {fw} не найден")
    if not db.query(Warehouse).filter(Warehouse.code == tw).first():
        raise HTTPException(400, f"Склад назначения {tw} не найден")
    assembler = db.query(User).filter(User.id == normalize(data.assembler_id).lower()).first()
    if not assembler or assembler.role not in ("supervisor", "admin", "warehouse"):
        raise HTTPException(400, "Укажите сотрудника склада для формирования")
    season, syear = current_season()
    kind = data.kind if data.kind in ("transfer", "return_defect") else "transfer"
    s = Shipment(
        id=sid, from_warehouse=fw, to_warehouse=tw, status="forming", kind=kind,
        assembler_id=assembler.id, created_by=user.id, season=season, season_year=syear,
    )
    db.add(s)
    log_op(db, "shipment_create", user.id, shipment_id=sid, comment=f"{fw}->{tw}")
    db.commit()
    return {"ok": True, "id": sid, "status": "forming", "message": f"Поставка {sid} создана, ожидает формирования"}

@app.post("/api/logistics/pack")
def pack_item(data: ShipmentPackIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    sid = normalize(data.shipment_id)
    eq_id = normalize(data.equipment_id).lower()
    if not is_shipment_id(sid):
        raise HTTPException(400, "Номер поставки: 11 цифр")
    if not is_equipment(eq_id):
        raise HTTPException(400, "Код: dd + 8 цифр")
    s = db.query(Shipment).filter(Shipment.id == sid).first()
    if not s or s.status != "forming":
        raise HTTPException(400, "Поставка не в статусе формирования")
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Оборудование не найдено")
    if db.query(ShipmentItem).filter(ShipmentItem.shipment_id == sid, ShipmentItem.equipment_id == eq_id).first():
        raise HTTPException(400, f"Повторный скан: {eq_id} уже в этой поставке")
    if eq.status == "in_shipment":
        raise HTTPException(400, f"Уже в другой поставке ({eq.shipment_id})")
    if eq.status == "in_bag":
        raise HTTPException(400, f"Сейчас в сумке {eq.bag_id}")
    if eq.status not in ("in_cell",):
        raise HTTPException(400, f"Повторный скан / нельзя: статус «{eq.status}»")
    eq.status = "in_shipment"
    eq.shipment_id = sid
    eq.cell_code = None
    eq.bag_id = None
    touch_equipment(eq, user.id)
    db.add(ShipmentItem(
        shipment_id=sid, equipment_id=eq.id, ean=eq.ean, name=eq.name,
        status="packed", packed_by=user.id,
    ))
    log_op(db, "shipment_pack", user.id, equipment_id=eq.id, shipment_id=sid)
    db.commit()
    cnt = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == sid).count()
    return {"ok": True, "message": f"{eq.name} → поставка {sid}", "items_count": cnt, "equipment_id": eq.id}

@app.post("/api/logistics/send")
def send_shipment(data: ShipmentActionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    sid = normalize(data.shipment_id)
    s = db.query(Shipment).filter(Shipment.id == sid).first()
    if not s or s.status != "forming":
        raise HTTPException(400, "Можно отправить только формирующуюся поставку")
    cnt = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == sid).count()
    if cnt == 0:
        raise HTTPException(400, "В поставке нет оборудования")
    s.status = "sent"
    s.sent_at = datetime.utcnow()
    log_op(db, "shipment_send", user.id, shipment_id=sid, comment=f"{cnt} ед.")
    db.commit()
    return {"ok": True, "message": f"Поставка {sid} отправлена ({cnt} ед.)", "status": "sent"}

@app.post("/api/logistics/start-receive")
def start_receive_shipment(data: ShipmentActionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    sid = normalize(data.shipment_id)
    if not is_shipment_id(sid):
        raise HTTPException(400, "Номер поставки: 11 цифр")
    s = db.query(Shipment).filter(Shipment.id == sid).first()
    if not s:
        raise HTTPException(404, "Поставка не найдена")
    if s.status not in ("sent", "receiving"):
        raise HTTPException(400, f"Нельзя принять (статус: {s.status})")
    s.status = "receiving"
    items = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == sid).all()
    db.commit()
    return {
        "ok": True, "shipment_id": sid, "to_warehouse": s.to_warehouse,
        "items": [{"equipment_id": i.equipment_id, "name": i.name, "ean": i.ean, "status": i.status} for i in items],
        "pending": [{"name": i.name, "ean": i.ean} for i in items if i.status == "packed"],
        "message": "Сканируйте dd и ячейку",
    }

@app.post("/api/logistics/receive-item")
def receive_shipment_item(data: ShipmentReceiveItemIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor", "warehouse"))):
    sid = normalize(data.shipment_id)
    eq_id = normalize(data.equipment_id).lower()
    cell = normalize(data.cell_code)
    if not is_cell(cell):
        raise HTTPException(400, "Неверный код ячейки")
    s = db.query(Shipment).filter(Shipment.id == sid).first()
    if not s or s.status != "receiving":
        raise HTTPException(400, "Поставка не на приёмке")
    item = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == sid, ShipmentItem.equipment_id == eq_id).first()
    if not item:
        raise HTTPException(404, "Этой единицы нет в поставке")
    if item.status == "received":
        raise HTTPException(400, "Уже принято")
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if eq:
        eq.status = "in_cell"
        eq.cell_code = cell
        eq.shipment_id = None
        eq.warehouse_code = s.to_warehouse
        touch_equipment(eq, user.id)
    item.status = "received"
    item.received_cell = cell
    item.received_by = user.id
    log_op(db, "shipment_receive_item", user.id, equipment_id=eq_id, shipment_id=sid, cell_code=cell)
    db.commit()
    pending = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == sid, ShipmentItem.status == "packed").count()
    return {"ok": True, "message": f"{item.name} → {cell}", "pending_count": pending}

@app.post("/api/logistics/finish-receive")
def finish_receive(data: ShipmentActionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "supervisor"))):
    sid = normalize(data.shipment_id)
    s = db.query(Shipment).filter(Shipment.id == sid).first()
    if not s or s.status != "receiving":
        raise HTTPException(400, "Поставка не на приёмке")
    packed = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == sid, ShipmentItem.status == "packed").all()
    shortage = []
    for item in packed:
        item.status = "missing"
        eq = db.query(Equipment).filter(Equipment.id == item.equipment_id).first()
        if eq:
            eq.status = "missing"
            eq.shipment_id = sid
        shortage.append({"equipment_id": item.equipment_id, "name": item.name, "ean": item.ean})
    import json
    if shortage:
        s.status = "received_shortage"
        s.shortage_json = json.dumps(shortage, ensure_ascii=False)
        # для UI при приёмке не показываем dd в pending — но в истории админу даём всё
        msg = f"Принято с недостачей ({len(shortage)} поз.)"
    else:
        s.status = "received"
        s.shortage_json = None
        msg = "Поставка принята полностью"
    s.received_at = datetime.utcnow()
    s.received_by = user.id
    log_op(db, "shipment_finish", user.id, shipment_id=sid, comment=msg)
    db.commit()
    # недостача без dd для экрана приёмки
    shortage_public = [{"name": x["name"], "ean": x.get("ean")} for x in shortage]
    return {
        "ok": True, "message": msg, "status": s.status,
        "shortage": shortage,  # полный для админа
        "shortage_public": shortage_public,  # без dd
        "has_shortage": len(shortage) > 0,
    }

@app.post("/api/logistics/visualize-shortage")
def visualize_shortage(data: ShipmentActionIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    sid = normalize(data.shipment_id)
    s = db.query(Shipment).filter(Shipment.id == sid).first()
    if not s or s.status != "received_shortage":
        raise HTTPException(400, "Нет недостачи для визирования")
    if s.shortage_visualized:
        raise HTTPException(400, "Уже визировано")
    items = db.query(ShipmentItem).filter(ShipmentItem.shipment_id == sid, ShipmentItem.status == "missing").all()
    for item in items:
        eq = db.query(Equipment).filter(Equipment.id == item.equipment_id).first()
        db.add(MissingReport(
            equipment_id=item.equipment_id,
            shipment_id=sid,
            warehouse_code=s.to_warehouse,
            reported_by=user.id,
            last_user_1=eq.last_user_1 if eq else None,
            last_user_2=eq.last_user_2 if eq else None,
            kind="missing", status="open",
        ))
        if eq:
            eq.status = "missing"
    s.shortage_visualized = True
    log_op(db, "shipment_visualize_shortage", user.id, shipment_id=sid)
    db.commit()
    return {"ok": True, "message": f"Недостача визирована: {len(items)} поз. в пропажах", "count": len(items)}



@app.get("/api/admin/backup")
def admin_backup(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    """JSON-снимок основных таблиц для ручного сохранения."""
    import json as _json
    from fastapi.responses import Response
    try:
        from database import DB_PATH
    except ImportError:
        try:
            from .database import DB_PATH
        except Exception:
            DB_PATH = os.environ.get("DOMOVOY_DB", "/tmp/domovoy_prod.db")

    def rows(model, fields):
        out = []
        for r in db.query(model).all():
            d = {}
            for f in fields:
                v = getattr(r, f, None)
                if hasattr(v, "isoformat"):
                    v = v.isoformat()
                d[f] = v
            out.append(d)
        return out

    data = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "app": "Домовой",
        "db_path": str(DB_PATH),
        "users": rows(User, ["id", "full_name", "role", "status", "block_reason", "home_warehouse", "birth_date"]),
        "warehouses": rows(Warehouse, ["code", "name", "is_main"]),
        "equipment_types": rows(EquipmentType, ["ean", "name", "category"]),
        "equipment": rows(Equipment, ["id", "ean", "name", "status", "cell_code", "bag_id", "warehouse_code", "shipment_id", "last_user_1", "last_user_2"]),
        "cells": rows(Cell, ["code", "warehouse_no", "region", "shelf", "slot", "warehouse_code"]),
        "bags": rows(Bag, ["id", "status", "order_id", "executor_id", "transfer_point", "warehouse_code"]),
        "orders": rows(Order, ["id", "client_name", "address", "object_info", "executor_id", "bag_id", "status", "warehouse_code", "is_late", "late_minutes", "cutoff_minutes"]),
        "shipments": rows(Shipment, ["id", "from_warehouse", "to_warehouse", "status", "kind", "assembler_id", "shortage_json", "season", "season_year"]),
        "shipment_items": rows(ShipmentItem, ["id", "shipment_id", "equipment_id", "ean", "name", "status", "received_cell"]),
        "missing_reports": rows(MissingReport, ["id", "equipment_id", "bag_id", "shipment_id", "warehouse_code", "kind", "status", "last_user_1", "last_user_2"]),
        "transfer_points": rows(TransferPoint, ["code", "name", "warehouse_code"]),
    }
    body = _json.dumps(data, ensure_ascii=False, indent=2)
    fname = "domovoy-backup-" + datetime.utcnow().strftime("%Y%m%d-%H%M") + ".json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Домовой", "version": "3.0"}

@app.get("/")
def index():
    path = os.path.join(FRONTEND, "index.html")
    if os.path.isfile(path):
        return FileResponse(path)
    # flat deploy: same folder as main
    alt = os.path.join(_here, "index.html")
    if os.path.isfile(alt):
        return FileResponse(alt)
    return HTMLResponse("<h1>Домовой</h1><p>Frontend not found</p>")

@app.get("/app.js")
def app_js():
    for p in [os.path.join(FRONTEND, "app.js"), os.path.join(_here, "app.js")]:
        if os.path.isfile(p):
            return FileResponse(p)
    raise HTTPException(404)

@app.get("/styles.css")
def app_css():
    for p in [os.path.join(FRONTEND, "styles.css"), os.path.join(_here, "styles.css")]:
        if os.path.isfile(p):
            return FileResponse(p)
    raise HTTPException(404)
