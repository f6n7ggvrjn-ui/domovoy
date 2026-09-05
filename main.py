
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
        User, Equipment, EquipmentType, Cell, Bag, Order, Operation, MissingReport, TransferPoint
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
        User, Equipment, EquipmentType, Cell, Bag, Order, Operation, MissingReport, TransferPoint
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
            ],
            "missing_reports": [
                ("kind", "VARCHAR(20) DEFAULT 'missing'"),
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

# ---------- auth ----------
@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    login = normalize(data.login).lower()
    user = db.query(User).filter(User.id == login).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    if user.status != "active":
        raise HTTPException(403, "Учётная запись неактивна")
    return {
        "access_token": make_token(user.id, user.role),
        "user": {
            "id": user.id, "full_name": user.full_name, "role": user.role,
            "role_label": ROLE_LABELS.get(user.role, user.role),
        },
    }

@app.get("/api/me")
def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id, "full_name": user.full_name, "role": user.role,
        "role_label": ROLE_LABELS.get(user.role, user.role),
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

@app.post("/api/employees")
def create_employee(data: EmployeeIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    if data.role not in ("warehouse", "cleaner", "handyman", "admin"):
        raise HTTPException(400, "Роль: warehouse / cleaner / handyman")
    nid = next_employee_id(db, user)["id"]
    while db.query(User).filter(User.id == nid).first():
        n = int(nid[2:]) + 1
        nid = f"us{n:06d}"
    pwd = data.password or "123456"
    u = User(
        id=nid, full_name=data.full_name, birth_date=data.birth_date,
        role=data.role if data.role != "admin" else "warehouse",
        status="active", password_hash=hash_password(pwd),
    )
    db.add(u)
    db.commit()
    return {"id": u.id, "full_name": u.full_name, "role": u.role, "password": pwd}

@app.patch("/api/employees/{emp_id}")
def update_employee(emp_id: str, data: EmployeeUpdateIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    u = db.query(User).filter(User.id == emp_id).first()
    if not u:
        raise HTTPException(404, "Сотрудник не найден")
    if data.full_name is not None:
        u.full_name = data.full_name
    if data.birth_date is not None:
        u.birth_date = data.birth_date
    if data.role is not None and data.role in ("warehouse", "cleaner", "handyman"):
        u.role = data.role
    if data.status is not None and data.status in ("active", "blocked", "fired"):
        u.status = data.status
    if data.password:
        u.password_hash = hash_password(data.password)
    db.commit()
    return {"ok": True, "id": u.id}

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

@app.get("/api/employees")
def list_employees(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    q = db.query(User).order_by(User.id)
    return [
        {"id": u.id, "full_name": u.full_name, "role": u.role,
         "role_label": ROLE_LABELS.get(u.role, u.role), "status": u.status,
         "birth_date": u.birth_date}
        for u in q.all()
    ]

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
def list_cells(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def assembly_board(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def list_bags(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def assembly_start(data: AssemblyStartIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def assembly_add_item(data: AssemblyItemIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
    if eq.status not in ("in_cell",):
        raise HTTPException(400, f"Нельзя положить: статус «{eq.status}»")
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
def assembly_finish(data: AssemblyFinishIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def issue_bag(data: IssueIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    exec_id = normalize(data.executor_id).lower()
    bag_id = normalize(data.bag_id).lower()
    if not is_user(exec_id):
        raise HTTPException(400, "Код сотрудника: us + 6 цифр")
    if not is_bag(bag_id):
        raise HTTPException(400, "Неверный код сумки")
    executor = db.query(User).filter(User.id == exec_id).first()
    if not executor or executor.status != "active":
        raise HTTPException(404, "Исполнитель не найден")
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
        touch_equipment(eq, user.id)
    log_op(db, "issue_to_executor", user.id, bag_id=bag.id, order_id=bag.order_id, comment=exec_id)
    db.commit()
    return {"ok": True, "message": f"Сумка {bag.id} выдана {executor.full_name}",
            "executor": {"id": executor.id, "name": executor.full_name}}

# ---------- unpack ----------
@app.post("/api/unpack/start")
def unpack_start(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def unpack_item(data: UnpackItemIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def unpack_damage(data: DamageIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    if not is_problem_zone(data.zone_code):
        raise HTTPException(400, f"Отсканируйте зону {PROBLEM_ZONE}")
    eq_id = normalize(data.equipment_id).lower()
    bag_id = normalize(data.bag_id).lower()
    eq = db.query(Equipment).filter(Equipment.id == eq_id).first()
    if not eq:
        raise HTTPException(404, "Не найдено")
    eq.status = "damaged"
    eq.bag_id = None
    eq.cell_code = PROBLEM_ZONE
    touch_equipment(eq, user.id)
    db.add(MissingReport(
        equipment_id=eq.id, bag_id=bag_id, reported_by=user.id,
        last_user_1=eq.last_user_1, last_user_2=eq.last_user_2,
        kind="damaged", status="open",
    ))
    log_op(db, "damage", user.id, bag_id=bag_id, equipment_id=eq.id, comment=PROBLEM_ZONE)
    db.commit()
    return {"ok": True, "message": f"{eq.id} → повреждённые"}

@app.post("/api/unpack/declare-empty")
def declare_empty(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.code).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    missing = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    return {
        "bag_id": bag.id,
        "missing": [{"id": e.id, "name": e.name, "last_user_1": e.last_user_1, "last_user_2": e.last_user_2} for e in missing],
        "has_missing": len(missing) > 0,
    }

@app.post("/api/unpack/start-investigation")
def start_investigation(data: ScanIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    bag_id = normalize(data.code).lower()
    bag = db.query(Bag).filter(Bag.id == bag_id).first()
    if not bag:
        raise HTTPException(404, "Сумка не найдена")
    missing = db.query(Equipment).filter(Equipment.bag_id == bag.id).all()
    reports = []
    for eq in missing:
        eq.status = "missing"
        eq.bag_id = None
        touch_equipment(eq, user.id)
        db.add(MissingReport(
            equipment_id=eq.id, bag_id=bag.id, order_id=bag.order_id,
            reported_by=user.id, last_user_1=eq.last_user_1, last_user_2=eq.last_user_2,
            kind="missing", status="open",
        ))
        reports.append(eq.id)
        log_op(db, "missing", user.id, bag_id=bag.id, equipment_id=eq.id)
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
def list_eans(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def receive_unit(data: ReceiveIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    ean = normalize(data.ean)
    eq_id = normalize(data.equipment_id).lower()
    if not is_equipment(eq_id):
        raise HTTPException(400, "Код: dd + 8 цифр")
    t = db.query(EquipmentType).filter(EquipmentType.ean == ean).first()
    if not t:
        raise HTTPException(404, "EAN не найден")
    if db.query(Equipment).filter(Equipment.id == eq_id).first():
        raise HTTPException(400, "Код единицы уже есть")
    eq = Equipment(id=eq_id, ean=ean, name=t.name, status="receiving")
    touch_equipment(eq, user.id)
    db.add(eq)
    log_op(db, "receive", user.id, equipment_id=eq.id, comment=ean)
    db.commit()
    return {"ok": True, "equipment_id": eq.id, "name": eq.name, "message": "Принято. Отсканируйте ячейку"}

@app.post("/api/receive/place")
def receive_place(data: PlaceIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def list_missing(db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
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
def reassign_order(order_id: str, data: ReassignIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def list_orders(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Order).order_by(Order.created_at.desc())
    if user.role in ("cleaner", "handyman"):
        q = q.filter(Order.executor_id == user.id)
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
def list_tp(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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
def return_bag(data: ReturnBagIn, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
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

@app.get("/api/tsd/signals")
def tsd_signals(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    orders = db.query(Order).filter(Order.status == "awaiting_assembly", Order.signal_sent == True).order_by(Order.created_at.desc()).limit(20).all()
    return [{"order_id": o.id, "address": o.address, "cutoff_minutes": o.cutoff_minutes,
             "executor_id": o.executor_id, "beep": True} for o in orders]

@app.get("/api/equipment")
def list_equipment(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "warehouse"))):
    return [{"id": e.id, "name": e.name, "status": e.status, "cell_code": e.cell_code,
             "bag_id": e.bag_id, "ean": e.ean, "last_user_1": e.last_user_1, "last_user_2": e.last_user_2}
            for e in db.query(Equipment).order_by(Equipment.id).all()]

@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Домовой", "version": "2.1"}

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
